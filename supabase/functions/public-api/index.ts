// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt) — the inbound API
// (migration 042). Authenticated by a practice's API key, not a user session:
//   Authorization: Bearer dc_…   or   X-Api-Key: dc_…
// Keys are created in Nastavitve → Integracije (owners), stored as a SHA-256
// hash; each key carries scopes.
//
// Endpoints (POST, JSON body; the action can be the path or "action"):
//   …/public-api/ping         → { ok, practice, scopes }   (any valid key)
//   …/public-api/unsubscribe  { "email": "…" }              (scope "unsubscribe")
//       Marketing consent → false for every patient of the key's practice with
//       that email (source 'api'), which also sends consent_withdrawn webhooks.
//       Never grants consent. Answers { ok: true, updated: n } — n = 0 when no
//       consented patient has that address.
//
// Deploy: supabase functions deploy public-api --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// JSON or form-encoded body (some tools only send forms).
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  const text = await req.text().catch(() => '');
  if (!text) return {};
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed', message: 'Use POST.' }, 405);

  const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  const key = req.headers.get('X-Api-Key')?.trim() || (bearer?.startsWith('dc_') ? bearer : '');
  if (!key || !key.startsWith('dc_') || key.length < 30) return json({ error: 'unauthorized', message: 'Missing or invalid API key.' }, 401);

  const { data: apiKey } = await service
    .from('api_keys')
    .select('id, practice_id, scopes, revoked_at, use_count')
    .eq('key_hash', await sha256Hex(key))
    .maybeSingle();
  if (!apiKey || apiKey.revoked_at) return json({ error: 'unauthorized', message: 'Missing or invalid API key.' }, 401);
  await service
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString(), use_count: (apiKey.use_count as number) + 1 })
    .eq('id', apiKey.id);

  const body = await readBody(req);
  const pathAction = new URL(req.url).pathname.split('/').filter(Boolean).pop();
  const action = (typeof body.action === 'string' ? body.action : pathAction !== 'public-api' ? pathAction : '') ?? '';
  const scopes = (apiKey.scopes as string[]) ?? [];

  if (action === 'ping') {
    const { data: practice } = await service.from('practices').select('name').eq('id', apiKey.practice_id).maybeSingle();
    return json({ ok: true, practice: practice?.name ?? null, scopes });
  }

  if (action === 'unsubscribe') {
    if (!scopes.includes('unsubscribe')) return json({ error: 'forbidden', message: 'This key may not unsubscribe.' }, 403);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email', message: 'Provide "email".' }, 400);
    const { data: updated, error } = await service
      .from('patients')
      .update({
        marketing_consent: false,
        marketing_consent_at: new Date().toISOString(),
        marketing_consent_source: 'api',
        marketing_consent_text: null,
      })
      .eq('practice_id', apiKey.practice_id)
      .ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`))
      .eq('marketing_consent', true)
      .select('id');
    if (error) return json({ error: 'server_error', message: error.message }, 500);
    return json({ ok: true, updated: updated?.length ?? 0 });
  }

  return json({ error: 'unknown_action', message: 'Use /ping or /unsubscribe.' }, 404);
});
