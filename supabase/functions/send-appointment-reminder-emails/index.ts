// Deno Edge Function — the daily reminder email send, 2 days before each
// appointment. Invoked hourly by pg_cron (see
// supabase/migrations/016_add_email_notifications.sql) and self-gates on
// the current Europe/Ljubljana wall-clock hour below, same reasoning as
// send-appointment-reminders' own SMS version — 09:00 here, deliberately a
// different hour than SMS's 14:00, purely so the two channels aren't
// coupled in time (an SES outage should never affect SMS reminders or vice
// versa — see that function's own header, and this being a fully separate
// function rather than shared logic, for the same reasoning).
//
// Deploy: supabase functions deploy send-appointment-reminder-emails
// (keep default JWT verification ON — cron-invoked only, same reasoning as
// send-appointment-confirmation-email's own Authorization check.)
//
// Secrets needed: SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_REGION,
// SES_SENDER_ADDRESS (see supabase/functions/_shared/email/send.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail, resolveSenderIdentity } from '../_shared/email/send.ts';
import { reminderEmail } from '../_shared/email/templates.ts';
import { logEmail, resolveUnsubscribeToken } from '../_shared/email/log.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function ljubljanaHour(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Ljubljana', hour: 'numeric', hour12: false }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'hour')?.value ?? -1);
}

function toLjubljanaYmd(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso)
  );
}

interface PatientJoin {
  id: string;
  first_name: string;
  email: string | null;
  email_opt_out: boolean;
}
interface PracticeJoin {
  id: string;
  name: string;
  contact_email: string | null;
  email_sending_mode: 'platform_default' | 'custom_domain';
  custom_domain: string | null;
  custom_domain_sender_local_part: string;
  custom_domain_verified: boolean;
}
interface AppointmentRow {
  id: string;
  starts_at: string;
  service: string | null;
  patients: PatientJoin | null;
  practices: PracticeJoin | null;
}

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (ljubljanaHour() !== 9) {
    return new Response('Not the scheduled hour, skipping.', { status: 200 });
  }

  const targetYmd = toLjubljanaYmd(new Date(Date.now() + 2 * 86400000).toISOString());
  const queryStart = new Date(Date.now() + 1 * 86400000).toISOString();
  const queryEnd = new Date(Date.now() + 3 * 86400000).toISOString();

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select(
      'id, starts_at, service, patients(id, first_name, email, email_opt_out), practices(id, name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified)'
    )
    .gte('starts_at', queryStart)
    .lt('starts_at', queryEnd)
    .not('status', 'in', '(cancelled,completed)');
  if (error) return new Response(`Query failed: ${error.message}`, { status: 500 });

  const targets = ((appointments ?? []) as unknown as AppointmentRow[]).filter(
    (a) => toLjubljanaYmd(a.starts_at) === targetYmd && !!a.patients?.email && !a.patients.email_opt_out && !!a.practices
  );

  let sent = 0;
  for (const appt of targets) {
    // Dedup — the unique index on (appointment_id, email_type) would reject
    // a second insert anyway, but check first to avoid a wasted SES send.
    const { data: existing } = await supabase
      .from('email_log')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('email_type', 'appointment_reminder')
      .maybeSingle();
    if (existing) continue;

    const patient = appt.patients as PatientJoin;
    const practice = appt.practices as PracticeJoin;

    const sender = resolveSenderIdentity({
      name: practice.name,
      emailSendingMode: practice.email_sending_mode,
      customDomain: practice.custom_domain,
      customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
      customDomainVerified: practice.custom_domain_verified,
    });

    const unsubscribeToken = await resolveUnsubscribeToken(supabase, patient.id);
    const unsubscribeUrl = `https://grgor123.github.io/dental-chart/email-unsubscribe.html?token=${unsubscribeToken}`;

    const content = reminderEmail({
      practiceName: practice.name,
      patientFirstName: patient.first_name,
      startsAt: appt.starts_at,
      service: appt.service,
      unsubscribeUrl,
    });

    try {
      const { messageId } = await sendEmail({
        to: patient.email!,
        sender,
        replyTo: practice.contact_email,
        subject: content.subject,
        html: content.html,
      });
      await logEmail(supabase, {
        patientId: patient.id,
        appointmentId: appt.id,
        emailType: 'appointment_reminder',
        recipientEmail: patient.email!,
        subject: content.subject,
        status: 'sent',
        providerMessageId: messageId,
        senderDomain: sender.fromDomain,
      });
      sent++;
    } catch (sendError) {
      console.error(`SES reminder send failed for appointment ${appt.id}:`, sendError);
      await logEmail(supabase, {
        patientId: patient.id,
        appointmentId: appt.id,
        emailType: 'appointment_reminder',
        recipientEmail: patient.email!,
        subject: content.subject,
        status: 'failed',
        senderDomain: sender.fromDomain,
        errorMessage: sendError instanceof Error ? sendError.message : String(sendError),
      });
    }
  }

  return new Response(`Sent ${sent} reminder email(s) for ${targetYmd}.`, { status: 200 });
});
