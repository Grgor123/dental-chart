// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt) — JSON API behind
// docs/marketing-consent.html (migration 039), same pattern as
// sms-consent-confirm: Supabase rewrites text/html to text/plain on the shared
// domain, so the page lives on GitHub Pages and fetch()es this.
//
// GET  ?token=… → { status: 'pending' | 'confirmed' | 'expired', practiceName, consentText }
//                 (no personal data — the token holder only learns the practice)
// POST ?token=… → the patient's own click: marketing_consent = true (source
//                 'email', the exact wording stored), which fires the
//                 consent_granted webhook (037/038).
//
// Deploy: supabase functions deploy marketing-consent-confirm --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const token = new URL(req.url).searchParams.get('token');
  if (!token || token.length < 20) return json({ error: 'invalid_token' }, 404);

  const { data: request } = await supabase
    .from('marketing_consent_requests')
    .select('id, patient_id, consent_text, expires_at, confirmed_at, practices(name)')
    .eq('token', token)
    .maybeSingle();
  if (!request) return json({ error: 'invalid_token' }, 404);
  const practices = request.practices as unknown as { name: string } | { name: string }[] | null;
  const practiceName = (Array.isArray(practices) ? practices[0]?.name : practices?.name) ?? '';
  const expired = !request.confirmed_at && new Date(request.expires_at as string) < new Date();

  if (req.method === 'POST') {
    if (expired) return json({ status: 'expired', practiceName });
    if (!request.confirmed_at) {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('marketing_consent_requests')
        .update({ confirmed_at: now })
        .eq('id', request.id)
        .is('confirmed_at', null);
      if (updateError) return json({ error: 'save_failed' }, 500);
      const { error: patientError } = await supabase
        .from('patients')
        .update({
          marketing_consent: true,
          marketing_consent_at: now,
          marketing_consent_source: 'email',
          marketing_consent_text: request.consent_text,
        })
        .eq('id', request.patient_id)
        .eq('marketing_consent', false);
      if (patientError) return json({ error: 'save_failed' }, 500);
    }
    return json({ status: 'confirmed', practiceName });
  }

  return json({
    status: request.confirmed_at ? 'confirmed' : expired ? 'expired' : 'pending',
    practiceName,
    consentText: request.consent_text,
  });
});
