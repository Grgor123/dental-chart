// Deno Edge Function — called by the `send_appointment_confirmation_email`
// Postgres trigger (supabase/migrations/016_add_email_notifications.sql)
// whenever an appointment is inserted. Sends the confirmation email (with
// an .ics calendar attachment) via Amazon SES — mirrors
// request-sms-consent's own trigger-invoked shape. The actual render/send/log
// work is the shared helper (_shared/email/sendAppointmentEmail.ts), which
// also applies the practice's own template override.
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
import { sendAppointmentEmail } from '../_shared/email/sendAppointmentEmail.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { appointmentId } = await req.json().catch(() => ({}));
  if (!appointmentId) return new Response('Missing appointmentId', { status: 400 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const outcome = await sendAppointmentEmail(supabase, { appointmentId, templateKey: 'appointment_confirmation' });

  if (outcome.status === 'failed') return new Response('Send failed', { status: 502 });
  if (outcome.status === 'skipped') return new Response(`No email sent: ${outcome.reason}.`, { status: 200 });
  return new Response('OK', { status: 200 });
});
