// Deno Edge Function — called by the `send_appointment_change_email`
// Postgres trigger (supabase/migrations/019_add_email_templates.sql) when an
// appointment is cancelled or moved to a new time. Sends the cancellation
// (.ics METHOD:CANCEL, which removes it from the patient's calendar) or
// reschedule (.ics with the same UID and a higher SEQUENCE, which updates the
// existing calendar entry) email through the shared send helper.
//
// Deploy: supabase functions deploy send-appointment-change-email
// (keep default JWT verification ON — trigger-invoked only, same explicit
// Bearer check as send-appointment-confirmation-email.)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendAppointmentEmail } from '../_shared/email/sendAppointmentEmail.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { appointmentId, kind } = await req.json().catch(() => ({}));
  if (!appointmentId || (kind !== 'cancelled' && kind !== 'rescheduled')) {
    return new Response('Missing appointmentId or invalid kind', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: appointment } = await supabase.from('appointments').select('status, starts_at').eq('id', appointmentId).single();
  if (!appointment) return new Response('Appointment not found', { status: 404 });

  // Cancelling/moving something already in the past (cleaning up history, or
  // marking an old no-show) shouldn't email the patient about it. Also guard
  // against the state having changed again between the trigger and now.
  if (new Date(appointment.starts_at).getTime() <= Date.now()) {
    return new Response('Appointment is in the past, not sending.', { status: 200 });
  }
  if (kind === 'rescheduled' && appointment.status === 'cancelled') {
    return new Response('Appointment was cancelled meanwhile, not sending a reschedule.', { status: 200 });
  }
  if (kind === 'cancelled' && appointment.status !== 'cancelled') {
    return new Response('Appointment is no longer cancelled, not sending.', { status: 200 });
  }

  const outcome = await sendAppointmentEmail(supabase, {
    appointmentId,
    templateKey: kind === 'cancelled' ? 'appointment_cancelled' : 'appointment_rescheduled',
  });

  if (outcome.status === 'failed') return new Response('Send failed', { status: 502 });
  if (outcome.status === 'skipped') return new Response(`No email sent: ${outcome.reason}.`, { status: 200 });
  return new Response('OK', { status: 200 });
});
