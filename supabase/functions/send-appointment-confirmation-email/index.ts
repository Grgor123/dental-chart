// Deno Edge Function — called by the `send_appointment_confirmation_email`
// Postgres trigger (supabase/migrations/016_add_email_notifications.sql)
// whenever an appointment is inserted. Sends the confirmation email (with
// an .ics calendar attachment) via Amazon SES — mirrors
// request-sms-consent's own trigger-invoked shape.
//
// Deploy: supabase functions deploy send-appointment-confirmation-email
// (keep default JWT verification ON — trigger-invoked only; see the
// explicit Authorization check below for why platform JWT verification
// alone isn't enough.)
//
// Secrets needed: SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_REGION,
// SES_SENDER_ADDRESS (see supabase/functions/_shared/email/send.ts).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail, resolveSenderIdentity } from '../_shared/email/send.ts';
import { confirmationEmail } from '../_shared/email/templates.ts';
import { buildIcsEvent } from '../_shared/email/ics.ts';
import { logEmail, resolveUnsubscribeToken } from '../_shared/email/log.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { appointmentId } = await req.json().catch(() => ({}));
  if (!appointmentId) return new Response('Missing appointmentId', { status: 400 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: appointment, error } = await supabase
    .from('appointments')
    .select(
      'id, starts_at, ends_at, service, practice_id, patients(id, first_name, email, email_opt_out), practices(id, name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified)'
    )
    .eq('id', appointmentId)
    .single();
  if (error || !appointment) return new Response('Appointment not found', { status: 404 });

  const patient = appointment.patients as unknown as {
    id: string;
    first_name: string;
    email: string | null;
    email_opt_out: boolean;
  } | null;
  const practice = appointment.practices as unknown as {
    id: string;
    name: string;
    contact_email: string | null;
    email_sending_mode: 'platform_default' | 'custom_domain';
    custom_domain: string | null;
    custom_domain_sender_local_part: string;
    custom_domain_verified: boolean;
  } | null;

  if (!patient || !patient.email || patient.email_opt_out || !practice) {
    return new Response('No email to send (no address on file, opted out, or missing data).', { status: 200 });
  }

  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });

  const unsubscribeToken = await resolveUnsubscribeToken(supabase, patient.id);
  const unsubscribeUrl = `https://grgor123.github.io/dental-chart/email-unsubscribe.html?token=${unsubscribeToken}`;

  const content = confirmationEmail({
    practiceName: practice.name,
    patientFirstName: patient.first_name,
    startsAt: appointment.starts_at,
    service: appointment.service,
    unsubscribeUrl,
  });

  const ics = buildIcsEvent({
    appointmentId: appointment.id,
    startsAt: appointment.starts_at,
    endsAt: appointment.ends_at,
    summary: appointment.service ? `Termin: ${appointment.service}` : 'Zobozdravstveni termin',
    organizerEmail: practice.contact_email || sender.fromAddress,
    organizerName: practice.name,
  });

  try {
    const { messageId } = await sendEmail({
      to: patient.email,
      sender,
      replyTo: practice.contact_email,
      subject: content.subject,
      html: content.html,
      attachmentIcs: { filename: 'termin.ics', content: ics },
    });
    await logEmail(supabase, {
      patientId: patient.id,
      appointmentId: appointment.id,
      emailType: 'appointment_confirmation',
      recipientEmail: patient.email,
      subject: content.subject,
      status: 'sent',
      providerMessageId: messageId,
      senderDomain: sender.fromDomain,
    });
  } catch (sendError) {
    console.error('SES confirmation send failed:', sendError);
    await logEmail(supabase, {
      patientId: patient.id,
      appointmentId: appointment.id,
      emailType: 'appointment_confirmation',
      recipientEmail: patient.email,
      subject: content.subject,
      status: 'failed',
      senderDomain: sender.fromDomain,
      errorMessage: sendError instanceof Error ? sendError.message : String(sendError),
    });
    return new Response('Send failed', { status: 502 });
  }

  return new Response('OK', { status: 200 });
});
