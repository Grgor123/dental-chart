// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt) — JSON API
// behind the SMS consent page. Supabase Edge Functions deliberately
// rewrite text/html responses to text/plain on the shared *.supabase.co
// domain (confirmed live, and documented at
// https://github.com/supabase/supabase/issues/50214 — Pro plan + a custom
// domain is the only way around it), so the actual page a patient sees
// lives on GitHub Pages instead (docs/sms-consent.html in this repo,
// published at https://grgor123.github.io/dental-chart/sms-consent.html)
// and calls this function via fetch() for both the page data and the
// confirm action — this function itself now only ever returns JSON.
//
// Deploy: supabase functions deploy sms-consent-confirm --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Wide open (`*`) rather than locked to the GitHub Pages origin — this
// endpoint is already only reachable with a valid, unguessable token, so a
// stricter CORS origin would add no real security, just fragility if the
// Pages URL ever changes.
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

  const { data: consent } = await supabase
    .from('patient_sms_consents')
    .select('id, patient_id, consent_text, granted_at')
    .eq('consent_token', token)
    .maybeSingle();
  if (!consent) return json({ error: 'invalid_token' }, 404);

  if (req.method === 'POST') {
    if (!consent.granted_at) {
      const now = new Date().toISOString();
      await supabase.from('patient_sms_consents').update({ granted_at: now }).eq('id', consent.id);
      await supabase
        .from('patients')
        .update({ sms_consent_status: 'granted', sms_consent_responded_at: now })
        .eq('id', consent.patient_id);
    }
    return json({ status: 'granted' });
  }

  return json({ status: consent.granted_at ? 'granted' : 'pending', consentText: consent.consent_text });
});
