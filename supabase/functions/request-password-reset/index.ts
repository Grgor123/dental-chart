// Deno Edge Function — "Pozabljeno geslo?" on the login screen (migration
// 036). Called without a session (only the public anon key), so it ALWAYS
// answers the same "if the address has an account, we've sent a link" — it
// never reveals whether an address exists. A link is sent only to a user who
// belongs to a practice and isn't blocked (removed), via our SES sender, and
// lands on the app's "Nastavite geslo" page.
//
// Deploy: supabase functions deploy request-password-reset
import { createClient } from 'npm:@supabase/supabase-js@2';
import { EMAIL_RE, findUserByEmail, redirectTarget, sendAccountEmail } from '../_shared/account.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) return json({ error: 'Vpišite veljaven e-poštni naslov.' }, 400);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  try {
    const user = await findUserByEmail(service, email);
    const banned = user?.banned_until ? new Date(user.banned_until) > new Date() : false;
    if (user && !banned) {
      const { data: membership } = await service.from('practice_members').select('practice_id').eq('user_id', user.id).limit(1).maybeSingle();
      if (membership) {
        const { data: link, error } = await service.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: redirectTarget(body?.redirectTo) },
        });
        if (!error && link) await sendAccountEmail(service, membership.practice_id as string, email, 'reset', link.properties.action_link);
      }
    }
  } catch (e) {
    // Logged only — the answer never differs, so it can't be used to probe addresses.
    console.error('Password reset failed:', e);
  }
  return json({ ok: true });
});
