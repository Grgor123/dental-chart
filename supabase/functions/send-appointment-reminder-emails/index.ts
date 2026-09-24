// Deno Edge Function — the reminder email send, N days before each
// appointment. Invoked hourly by pg_cron (see
// supabase/migrations/016_add_email_notifications.sql). Each practice picks
// its own days-before and send hour in the El. pošta template editor
// (email_templates.timing_value / send_hour — defaults 2 days, 09:00
// Europe/Ljubljana, a deliberately different hour than SMS's 14:00 so the two
// channels aren't coupled in time: an SES outage should never affect SMS
// reminders or vice versa — see send-appointment-reminders' own header, and
// this being a fully separate function rather than shared logic, for the
// same reasoning). So the gate is per practice, evaluated on every hourly run.
//
// Deploy: supabase functions deploy send-appointment-reminder-emails
// (keep default JWT verification ON — cron-invoked only, same reasoning as
// send-appointment-confirmation-email's own Authorization check.)
//
// Secrets needed: SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_REGION,
// SES_SENDER_ADDRESS (see supabase/functions/_shared/email/send.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { loadAllOverrides, sendAppointmentEmail } from '../_shared/email/sendAppointmentEmail.ts';
import { effectiveSettings } from '../_shared/email/templateDefs.ts';
import { ljubljanaHour, toLjubljanaYmd } from '../_shared/email/time.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const DAY_MS = 86400000;

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const currentHour = ljubljanaHour();

  const { data: practices, error: practicesError } = await supabase.from('practices').select('id');
  if (practicesError) return new Response(`Query failed: ${practicesError.message}`, { status: 500 });
  const overrides = await loadAllOverrides(supabase, 'appointment_reminder');

  let sent = 0;
  for (const practice of practices ?? []) {
    const settings = effectiveSettings('appointment_reminder', overrides.get(practice.id) ?? null);
    if (!settings.enabled || settings.sendHour !== currentHour || settings.timingValue === null) continue;

    const daysAhead = settings.timingValue;
    const targetYmd = toLjubljanaYmd(new Date(Date.now() + daysAhead * DAY_MS).toISOString());
    // A day either side of the target instant, then filtered to the exact
    // Ljubljana calendar day below — DST shifts the day boundary by an hour.
    const queryStart = new Date(Date.now() + (daysAhead - 1) * DAY_MS).toISOString();
    const queryEnd = new Date(Date.now() + (daysAhead + 1) * DAY_MS).toISOString();

    const { data: appointments, error } = await supabase
      .from('appointments')
      .select('id, starts_at')
      .eq('practice_id', practice.id)
      .gte('starts_at', queryStart)
      .lt('starts_at', queryEnd)
      .not('status', 'in', '(cancelled,completed)');
    if (error) {
      console.error(`Reminder query failed for practice ${practice.id}:`, error.message);
      continue;
    }

    for (const appointment of appointments ?? []) {
      if (toLjubljanaYmd(appointment.starts_at) !== targetYmd) continue;
      const outcome = await sendAppointmentEmail(supabase, { appointmentId: appointment.id, templateKey: 'appointment_reminder' });
      if (outcome.status === 'sent') sent++;
    }
  }

  return new Response(`Sent ${sent} reminder email(s).`, { status: 200 });
});
