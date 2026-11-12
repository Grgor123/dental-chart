// Deno Edge Function — emails a patient the link to read and sign a consent
// (patient_consents, migration 058). Called from the patient record's
// "Podpis soglasja" window ("Pošlji po e-pošti") with the signed-in user's
// session (default JWT verification ON); body { consentId }. The dentist has
// already confirmed the explanation in the practice; the patient reads and
// signs at home (docs/patient-consent.html, the same page as the QR code).
//
// The consent is looked up through a client carrying THAT user's JWT first,
// so RLS decides whether this user may touch it at all — another practice's
// consent simply isn't found. Only then does the service-role client send
// (it reads the practice's sender settings and writes email_log).
//
// Each send renews the link's 30-day validity.
//
// Deploy: supabase functions deploy send-patient-consent
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail, resolveSenderIdentity } from '../_shared/email/send.ts';
import { renderTemplate } from '../_shared/email/templates.ts';
import { logEmail, resolveUnsubscribeToken } from '../_shared/email/log.ts';
import { loadTemplateOverride, unsubscribeUrl } from '../_shared/email/sendAppointmentEmail.ts';
import { publicPageUrl } from '../_shared/publicPages.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const LINK_VALID_DAYS = 30;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

interface PatientRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  email_opt_out: boolean;
  practice_id: string;
  practices: {
    name: string;
    contact_email: string | null;
    email_sending_mode: 'platform_default' | 'custom_domain';
    custom_domain: string | null;
    custom_domain_sender_local_part: string;
    custom_domain_verified: boolean;
  } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => null);
  const consentId = typeof body?.consentId === 'string' ? body.consentId : null;
  if (!consentId) return json({ error: 'Missing consentId' }, 400);

  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: consent } = await asUser
    .from('patient_consents')
    .select('id, patient_id, token, signed_at, cancelled_at, explained_at')
    .eq('id', consentId)
    .maybeSingle();
  if (!consent) return json({ error: 'Soglasja ni mogoče najti.' }, 404);
  if (consent.signed_at) return json({ error: 'Soglasje je že podpisano.' }, 409);
  if (consent.cancelled_at) return json({ error: 'Soglasje je preklicano.' }, 409);
  if (!consent.explained_at) return json({ error: 'Najprej potrdite, da ste poseg pojasnili.' }, 409);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data } = await service
    .from('patients')
    .select(
      'id, first_name, last_name, email, email_opt_out, practice_id, practices(name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified)'
    )
    .eq('id', consent.patient_id)
    .single();
  const patient = data as unknown as PatientRow | null;
  const practice = patient?.practices;
  if (!patient || !practice) return json({ error: 'Pacienta ni mogoče najti.' }, 404);
  if (!patient.email) return json({ error: 'Pacient nima e-poštnega naslova.' }, 409);
  if (patient.email_opt_out) return json({ error: 'Pacient se je odjavil od e-pošte — uporabite kodo QR.' }, 409);

  const now = new Date();
  await service
    .from('patient_consents')
    .update({ sent_at: now.toISOString(), expires_at: new Date(now.getTime() + LINK_VALID_DAYS * 86400000).toISOString() })
    .eq('id', consent.id);

  const override = await loadTemplateOverride(service, patient.practice_id, 'patient_consent');
  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });
  const unsubscribeToken = await resolveUnsubscribeToken(service, patient.id);
  const content = renderTemplate(
    'patient_consent',
    override,
    { ime: patient.first_name, priimek: patient.last_name, datum: '', ura: '', storitev: '', terapevt: '', ordinacija: practice.name },
    {
      practiceName: practice.name,
      unsubscribeUrl: unsubscribeUrl(unsubscribeToken),
      actionUrl: publicPageUrl('patient-consent.html', consent.token as string),
    }
  );

  try {
    const { messageId } = await sendEmail({
      to: patient.email,
      sender,
      replyTo: practice.contact_email,
      subject: content.subject,
      html: content.html,
      attachmentIcs: null,
    });
    await logEmail(service, {
      patientId: patient.id,
      appointmentId: null,
      emailType: 'patient_consent',
      recipientEmail: patient.email,
      subject: content.subject,
      bodyHtml: content.html,
      status: 'sent',
      providerMessageId: messageId,
      senderDomain: sender.fromDomain,
    });
    return json({ status: 'sent', sentTo: patient.email });
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError);
    console.error(`SES consent send failed for patient ${patient.id}:`, sendError);
    await logEmail(service, {
      patientId: patient.id,
      appointmentId: null,
      emailType: 'patient_consent',
      recipientEmail: patient.email,
      subject: content.subject,
      bodyHtml: content.html,
      status: 'failed',
      senderDomain: sender.fromDomain,
      errorMessage: message,
    });
    return json({ error: message }, 502);
  }
});
