// Deno Edge Function — "Pošlji soglasje" on the patient record (migration
// 039): emails the patient a request for marketing consent with one confirm
// button (double opt-in). Staff can ask, never grant: only the patient's own
// click on docs/marketing-consent.html (→ marketing-consent-confirm) sets
// marketing_consent = true.
//
// Called from the browser with the signed-in user's session (default JWT
// verification ON). The patient is read through that user's RLS first, so
// only their own practice's patients can be asked; the service role then
// writes the request row, sends via SES and logs to email_log.
//
// An open (unconfirmed, unexpired) request is re-used, so a second click
// re-sends the same link instead of piling up tokens. Not sent to a patient
// without an email address, who unsubscribed from email, or who already
// consents.
//
// Deploy: supabase functions deploy request-marketing-consent
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveSenderIdentity, sendEmail } from '../_shared/email/send.ts';
import { renderActionEmail } from '../_shared/email/templates.ts';
import { logEmail } from '../_shared/email/log.ts';
import { FORM_TEXT } from '../_shared/questionnaire.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CONSENT_PAGE_URL = 'https://grgor123.github.io/dental-chart/marketing-consent.html';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function randomToken(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => null);
  const patientId = typeof body?.patientId === 'string' ? body.patientId : null;
  if (!patientId) return json({ error: 'Manjka pacient.' }, 400);

  // ---- Through the user's own RLS -------------------------------------------------
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: patient } = await asUser
    .from('patients')
    .select('id, practice_id, first_name, email, email_opt_out, marketing_consent, marketing_consent_at')
    .eq('id', patientId)
    .maybeSingle();
  if (!patient) return json({ error: 'Pacient ni bil najden.' }, 404);
  if (!patient.email) return json({ error: 'Pacient nima e-poštnega naslova.' }, 400);
  if (patient.email_opt_out) return json({ error: 'Pacient je odjavljen od e-pošte — prošnje ni mogoče poslati.' }, 400);
  if (patient.marketing_consent) return json({ error: 'Pacient že soglaša.' }, 409);
  const { data: userData } = await asUser.auth.getUser();
  const requestedBy = userData?.user?.id ?? null;

  // ---- Service role --------------------------------------------------------------------
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const email = (patient.email as string).trim().toLowerCase();
  const consentText = FORM_TEXT.marketingText.sl;

  // Re-use an open request only if it was sent after the last consent change
  // (an older one was overtaken by the patient's later answer).
  let openQuery = service
    .from('marketing_consent_requests')
    .select('id, token')
    .eq('patient_id', patient.id)
    .eq('email', email)
    // Only a request with today's wording — after the wording changes, the
    // patient must see (and confirm) the new text.
    .eq('consent_text', consentText)
    .is('confirmed_at', null)
    .gt('expires_at', new Date(Date.now() + 24 * 3600 * 1000).toISOString());
  if (patient.marketing_consent_at) openQuery = openQuery.gt('created_at', patient.marketing_consent_at as string);
  const { data: open } = await openQuery.order('created_at', { ascending: false }).limit(1).maybeSingle();
  let token = open?.token as string | undefined;
  if (!token) {
    token = randomToken();
    const { error: insertError } = await service.from('marketing_consent_requests').insert({
      practice_id: patient.practice_id,
      patient_id: patient.id,
      token,
      email,
      consent_text: consentText,
      requested_by: requestedBy,
    });
    if (insertError) return json({ error: insertError.message }, 500);
  }

  const { data: practice } = await service
    .from('practices')
    .select('name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified')
    .eq('id', patient.practice_id)
    .single();
  if (!practice) return json({ error: 'Ordinacija ni bila najdena.' }, 500);
  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });

  const subject = `Bi želeli prejemati naše novice? — ${practice.name}`;
  const content = renderActionEmail({
    practiceName: practice.name,
    heading: 'Prejemanje novic in obvestil',
    message:
      `Pozdravljeni${patient.first_name ? ` ${patient.first_name}` : ''},\n\n` +
      `občasno pošiljamo e-poštna obvestila o novostih, promocijah in preventivnih pregledih. Če jih želite prejemati, to potrdite s klikom na spodnji gumb:\n\n` +
      `**${consentText}**\n\n` +
      `Če ne želite, tega sporočila preprosto ne upoštevajte — brez vaše potrditve vam obvestil ne bomo pošiljali.`,
    action: { label: 'Da, želim prejemati obvestila', url: `${CONSENT_PAGE_URL}?token=${token}` },
    footnote: 'Povezava velja 30 dni. Soglasje lahko kadarkoli prekličete.',
  });

  try {
    const { messageId } = await sendEmail({ to: email, sender, replyTo: practice.contact_email, subject, html: content.html });
    await logEmail(service, {
      patientId: patient.id,
      emailType: 'marketing_consent',
      recipientEmail: email,
      subject,
      status: 'sent',
      providerMessageId: messageId,
      senderDomain: sender.fromDomain,
      bodyHtml: content.html,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logEmail(service, {
      patientId: patient.id,
      emailType: 'marketing_consent',
      recipientEmail: email,
      subject,
      status: 'failed',
      senderDomain: sender.fromDomain,
      errorMessage: message,
    });
    return json({ error: `E-pošte ni bilo mogoče poslati: ${message}` }, 502);
  }
  return json({ ok: true, email });
});
