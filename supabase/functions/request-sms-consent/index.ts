// Deno Edge Function — called by the `request_sms_consent_on_phone_change`
// Postgres trigger (supabase/migrations/015_add_sms_reminders.sql) whenever
// a patient's phone is set/changed. Sends the one-button SMS consent
// opt-in request via Lertify — the same account/credential as the sibling
// "dental calendar" booking-widget project's own SMS reminders.
//
// Deploy: supabase functions deploy request-sms-consent
// (keep default JWT verification ON — this is trigger-invoked only, never
// a public patient-facing endpoint; see the explicit Authorization check
// below for why that alone isn't enough.)
//
// Secrets needed (shared with the other SMS functions — set once per
// project): LERTIFY_API_KEY, LERTIFY_SENDER
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the
// platform into every Edge Function's own environment already.
//
// LERTIFY REQUEST SHAPE: verified against the sibling n8n workflow's own
// live, working "Send SMS via Lertify" node (read via the n8n API) rather
// than guessed — auth is a plain `apiKey` header (not `Authorization:
// Bearer`), phone goes in a `destinations` array, and `message` is an
// object ({content, isUnicode}), not a plain string.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LERTIFY_API_KEY = Deno.env.get('LERTIFY_API_KEY')!;
const LERTIFY_SENDER = Deno.env.get('LERTIFY_SENDER')!;

function randomToken(length = 10): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

Deno.serve(async (req) => {
  // Supabase's own platform-level JWT check accepts any valid session
  // token, not just the service role — a signed-in staff member's own
  // session is technically a "valid JWT" too. This explicit check closes
  // that gap: only whoever holds the real service-role key (the Postgres
  // trigger, via Vault) can actually make this function do anything.
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { patientId } = await req.json().catch(() => ({}));
  if (!patientId) return new Response('Missing patientId', { status: 400 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: patient, error } = await supabase
    .from('patients')
    .select('id, phone')
    .eq('id', patientId)
    .single();
  if (error || !patient) return new Response('Patient not found', { status: 404 });
  if (!patient.phone) return new Response('No phone on file', { status: 200 });

  const token = randomToken();
  const consentText =
    'Zobozdravstvo Goslar bo na to številko pošiljal SMS opomnike pred vašimi termini. S klikom na spodnji gumb se s tem strinjate.';

  const { error: insertError } = await supabase.from('patient_sms_consents').insert({
    patient_id: patientId,
    consent_token: token,
    consent_text: consentText,
  });
  if (insertError) return new Response(`Failed to record consent request: ${insertError.message}`, { status: 500 });

  // Points at the GitHub Pages page, not this Edge Function's own URL —
  // see sms-consent-confirm's own comment for why (Supabase won't serve
  // real HTML from *.supabase.co).
  const link = `https://grgor123.github.io/dental-chart/sms-consent.html?token=${token}`;
  const message = `Zobozdravstvo Goslar: za prejemanje SMS opomnikov o terminih potrdite tukaj: ${link}`;

  const lertifyRes = await fetch('https://api.lertify.app/v1/sms/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apiKey: LERTIFY_API_KEY },
    body: JSON.stringify({
      sender: LERTIFY_SENDER,
      destinations: [patient.phone],
      message: { content: message, isUnicode: false },
    }),
  });
  if (!lertifyRes.ok) {
    const body = await lertifyRes.text().catch(() => '');
    console.error('Lertify consent-request send failed:', lertifyRes.status, body);
    return new Response(`Lertify send failed: ${body}`, { status: 502 });
  }

  return new Response('OK', { status: 200 });
});
