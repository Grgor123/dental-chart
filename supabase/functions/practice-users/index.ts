// Deno Edge Function — Nastavitve → Uporabniki (migration 036): the users of
// the caller's practice, and (owners only) invite / re-send / change role /
// remove.
//
// Called from the browser with the signed-in user's own session (default JWT
// verification ON). The caller is identified from that JWT and their practice
// and role are read with the service role — never taken from the request.
// Everything acts on the caller's own practice only.
//
// - invite: records a practice_invitations row FIRST, then generateLink
//   ('invite') creates the auth user — the signup trigger
//   (handle_new_user_practice) sees the invitation and joins the user to this
//   practice instead of creating a new one. The link is emailed via SES.
//   An address that already has an account: if it belongs to no practice
//   (someone removed earlier) it's re-joined; if it belongs to another
//   practice, refused (one practice per login for now).
// - remove: deletes the membership and blocks the login (ban) — the auth user
//   is kept, since invoices/records reference it. The last owner can't be
//   removed or demoted, so a practice can't lock itself out.
//
// Deploy: supabase functions deploy practice-users
import { createClient } from 'npm:@supabase/supabase-js@2';
import { EMAIL_RE, findUserByEmail, redirectTarget, sendAccountEmail } from '../_shared/account.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BAN_FOREVER = '876000h'; // ~100 years

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

type Role = 'owner' | 'staff';
const isRole = (r: unknown): r is Role => r === 'owner' || r === 'staff';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  // The caller, from the claims of their access token. The Supabase gateway
  // has already verified its signature and expiry (JWT verification is ON for
  // this function) — the same check PostgREST/RLS rely on for every query.
  // auth.getUser(jwt) was tried first and answered "Auth session missing!"
  // for valid, signed-in users (live, 2026-10-14), so it isn't used.
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  let claims: { sub?: string; role?: string; email?: string; exp?: number } = {};
  try {
    claims = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    // not a JWT — rejected below
  }
  if (claims.role !== 'authenticated' || !claims.sub || (claims.exp ?? 0) * 1000 < Date.now()) {
    return json({ error: 'Prijava ni veljavna. Odjavite se in se prijavite znova.' }, 401);
  }
  const callerId = claims.sub;
  const callerEmail = claims.email ?? null;
  const { data: membership } = await service
    .from('practice_members')
    .select('practice_id, role')
    .eq('user_id', callerId)
    .limit(1)
    .maybeSingle();
  if (!membership) return json({ error: 'Vaš račun ni povezan z ordinacijo.' }, 403);
  const practiceId = membership.practice_id as string;
  const callerRole = membership.role as Role;

  const body = await req.json().catch(() => null);
  const action = typeof body?.action === 'string' ? body.action : 'list';

  // ---- list (everyone in the practice) -------------------------------------------
  async function list() {
    const { data: members, error } = await service
      .from('practice_members')
      .select('user_id, role, created_at')
      .eq('practice_id', practiceId)
      .order('created_at');
    if (error) return json({ error: error.message }, 500);
    const ids = (members ?? []).map((m) => m.user_id as string);
    const { data: profiles } = ids.length
      ? await service.from('user_profiles').select('user_id, full_name').in('user_id', ids)
      : { data: [] };
    const nameById = new Map((profiles ?? []).map((p) => [p.user_id as string, (p.full_name as string | null) ?? null]));
    const users = [];
    for (const m of members ?? []) {
      const { data: u } = await service.auth.admin.getUserById(m.user_id as string);
      users.push({
        userId: m.user_id,
        email: u.user?.email ?? '',
        fullName: nameById.get(m.user_id as string) ?? null,
        role: m.role,
        joinedAt: m.created_at,
        lastSignInAt: u.user?.last_sign_in_at ?? null,
        // Invited but hasn't set a password / signed in yet.
        pending: !u.user?.last_sign_in_at,
      });
    }
    return json({ callerId, callerRole, users });
  }

  if (action === 'list') return list();
  if (callerRole !== 'owner') return json({ error: 'Uporabnike lahko upravlja le lastnik ordinacije.' }, 403);

  const { data: callerProfile } = await service.from('user_profiles').select('full_name').eq('user_id', callerId).maybeSingle();
  const inviterName = (callerProfile?.full_name as string | null) || callerEmail;
  const redirectTo = redirectTarget(body?.redirectTo);

  async function ownerCount(): Promise<number> {
    const { count } = await service
      .from('practice_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('practice_id', practiceId)
      .eq('role', 'owner');
    return count ?? 0;
  }

  async function memberRole(userId: string): Promise<Role | null> {
    const { data } = await service
      .from('practice_members')
      .select('role')
      .eq('practice_id', practiceId)
      .eq('user_id', userId)
      .maybeSingle();
    return (data?.role as Role | undefined) ?? null;
  }

  // ---- invite ------------------------------------------------------------------------
  if (action === 'invite') {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const fullName = typeof body?.fullName === 'string' ? body.fullName.trim().slice(0, 120) : '';
    const role: Role = isRole(body?.role) ? body.role : 'staff';
    if (!EMAIL_RE.test(email)) return json({ error: 'Vpišite veljaven e-poštni naslov.' }, 400);

    const existing = await findUserByEmail(service, email);
    if (existing) {
      const { data: other } = await service.from('practice_members').select('practice_id').eq('user_id', existing.id).limit(1).maybeSingle();
      if (other?.practice_id === practiceId) return json({ error: 'Ta oseba je že uporabnik vaše ordinacije.' }, 409);
      if (other) return json({ error: 'Ta e-poštni naslov že uporablja druga ordinacija.' }, 409);
      // Removed earlier (or never joined): re-join, unblock, send a set-password link.
      const { error: joinError } = await service.from('practice_members').insert({ practice_id: practiceId, user_id: existing.id, role });
      if (joinError) return json({ error: joinError.message }, 500);
      await service.auth.admin.updateUserById(existing.id, { ban_duration: 'none' });
      if (fullName) {
        await service.from('user_profiles').upsert({ user_id: existing.id, practice_id: practiceId, full_name: fullName }, { onConflict: 'user_id' });
      }
      const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
      if (linkError || !link) return json({ error: linkError?.message ?? 'Povezave ni bilo mogoče ustvariti.' }, 500);
      await sendAccountEmail(service, practiceId, email, 'invite', link.properties.action_link, inviterName);
      return list();
    }

    // The invitation first — the signup trigger looks for it.
    const { data: invitation, error: invError } = await service
      .from('practice_invitations')
      .insert({ practice_id: practiceId, email, full_name: fullName || null, role, invited_by: callerId })
      .select('id')
      .single();
    if (invError) return json({ error: invError.message }, 500);
    const { data: link, error: linkError } = await service.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo, data: fullName ? { full_name: fullName } : undefined },
    });
    if (linkError || !link) {
      await service.from('practice_invitations').delete().eq('id', invitation.id);
      return json({ error: linkError?.message ?? 'Vabila ni bilo mogoče ustvariti.' }, 500);
    }
    try {
      await sendAccountEmail(service, practiceId, email, 'invite', link.properties.action_link, inviterName);
    } catch (sendError) {
      return json({ error: `Uporabnik je dodan, e-pošte pa ni bilo mogoče poslati: ${sendError instanceof Error ? sendError.message : sendError}. Poskusite »Pošlji znova«.` }, 502);
    }
    return list();
  }

  const userId = typeof body?.userId === 'string' ? body.userId : '';
  const currentRole = userId ? await memberRole(userId) : null;
  if (!currentRole) return json({ error: 'Uporabnik ni bil najden.' }, 404);

  // ---- resend -------------------------------------------------------------------------
  if (action === 'resend') {
    const { data: u } = await service.auth.admin.getUserById(userId);
    const email = u.user?.email;
    if (!email) return json({ error: 'Uporabnik nima e-poštnega naslova.' }, 400);
    const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
    if (linkError || !link) return json({ error: linkError?.message ?? 'Povezave ni bilo mogoče ustvariti.' }, 500);
    try {
      await sendAccountEmail(service, practiceId, email, 'invite', link.properties.action_link, inviterName);
    } catch (sendError) {
      return json({ error: `E-pošte ni bilo mogoče poslati: ${sendError instanceof Error ? sendError.message : sendError}` }, 502);
    }
    return list();
  }

  // ---- set_role -------------------------------------------------------------------------
  if (action === 'set_role') {
    const role = body?.role;
    if (!isRole(role)) return json({ error: 'Neveljavna vloga.' }, 400);
    if (currentRole === 'owner' && role === 'staff' && (await ownerCount()) <= 1) {
      return json({ error: 'Ordinacija mora imeti vsaj enega lastnika.' }, 409);
    }
    const { error } = await service.from('practice_members').update({ role }).eq('practice_id', practiceId).eq('user_id', userId);
    if (error) return json({ error: error.message }, 500);
    return list();
  }

  // ---- remove ----------------------------------------------------------------------------
  if (action === 'remove') {
    if (userId === callerId) return json({ error: 'Sebe ne morete odstraniti.' }, 409);
    if (currentRole === 'owner' && (await ownerCount()) <= 1) {
      return json({ error: 'Ordinacija mora imeti vsaj enega lastnika.' }, 409);
    }
    const { error } = await service.from('practice_members').delete().eq('practice_id', practiceId).eq('user_id', userId);
    if (error) return json({ error: error.message }, 500);
    // Keep the auth user (records reference it), but block the login.
    await service.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER });
    return list();
  }

  return json({ error: 'Unknown action' }, 400);
});
