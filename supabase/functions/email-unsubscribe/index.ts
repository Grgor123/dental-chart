// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt) — JSON API
// behind the email-unsubscribe page. Same reason as sms-consent-confirm for
// why this only serves JSON: Supabase Edge Functions rewrite text/html to
// text/plain on the shared *.supabase.co domain (confirmed live — see that
// function's own comment for the source). The actual page lives on GitHub
// Pages (docs/email-unsubscribe.html, published at
// https://grgor123.github.io/dental-chart/email-unsubscribe.html) and calls
// this function via fetch().
//
// Deploy: supabase functions deploy email-unsubscribe --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Wide open, same reasoning as sms-consent-confirm/appointment-confirm —
// already gated by a real unguessable token, so a stricter CORS origin adds
// no real security.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'missing_token' }, 400);

  const { data: patient } = await supabase
    .from('patients')
    .select('id, email_opt_out, practices(name)')
    .eq('email_unsubscribe_token', token)
    .maybeSingle();
  if (!patient) return json({ error: 'invalid_token' }, 404);

  const practice = patient.practices as unknown as { name: string } | null;

  if (req.method === 'POST') {
    if (!patient.email_opt_out) {
      await supabase
        .from('patients')
        .update({ email_opt_out: true, email_opt_out_at: new Date().toISOString() })
        .eq('id', patient.id);
    }
    return json({ status: 'opted_out', practiceName: practice?.name ?? '' });
  }

  return json({ status: patient.email_opt_out ? 'opted_out' : 'subscribed', practiceName: practice?.name ?? '' });
});
