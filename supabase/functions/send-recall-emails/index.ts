// Deno Edge Function — the recall ("time for a check-up") email. Invoked
// hourly by pg_cron (supabase/migrations/019_add_email_templates.sql) and
// gated per practice on its own send hour (default 10:00 Europe/Ljubljana),
// like send-appointment-reminder-emails.
//
// A patient is a recall candidate when their LAST completed appointment was
// between N and N+1 months ago (N = the practice's `timing_value`, default 6)
// and they have no upcoming appointment. The one-month window is deliberate:
// turning recall on for the first time (or enabling it on a practice with
// years of history) must never mass-email long-gone patients, and a monthly
// window still lets a missed day or outage catch up on a later run. Dedup is
// the email_log unique index keyed to that last appointment, so each patient
// gets one recall per last visit.
//
// Deploy: supabase functions deploy send-recall-emails
// (keep default JWT verification ON — cron-invoked only.)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { loadAllOverrides, sendAppointmentEmail } from '../_shared/email/sendAppointmentEmail.ts';
import { effectiveSettings } from '../_shared/email/templateDefs.ts';
import { ljubljanaHour } from '../_shared/email/time.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function monthsAgo(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

interface CompletedAppointment {
  id: string;
  patient_id: string;
  starts_at: string;
}

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const currentHour = ljubljanaHour();

  const { data: practices, error: practicesError } = await supabase.from('practices').select('id');
  if (practicesError) return new Response(`Query failed: ${practicesError.message}`, { status: 500 });
  const overrides = await loadAllOverrides(supabase, 'recall');

  let sent = 0;
  for (const practice of practices ?? []) {
    const settings = effectiveSettings('recall', overrides.get(practice.id) ?? null);
    if (!settings.enabled || settings.sendHour !== currentHour || settings.timingValue === null) continue;

    const recentCutoff = monthsAgo(settings.timingValue).toISOString();
    const oldCutoff = monthsAgo(settings.timingValue + 1).toISOString();

    // Every completed visit from the window start to now — including the
    // ones more recent than the recent cutoff, so a patient who has visited
    // since is correctly seen as NOT due (their latest visit is too recent).
    const { data: completed, error } = await supabase
      .from('appointments')
      .select('id, patient_id, starts_at')
      .eq('practice_id', practice.id)
      .eq('status', 'completed')
      .gte('starts_at', oldCutoff)
      .lte('starts_at', new Date().toISOString());
    if (error) {
      console.error(`Recall query failed for practice ${practice.id}:`, error.message);
      continue;
    }

    const lastByPatient = new Map<string, CompletedAppointment>();
    for (const appointment of (completed ?? []) as CompletedAppointment[]) {
      const current = lastByPatient.get(appointment.patient_id);
      if (!current || appointment.starts_at > current.starts_at) lastByPatient.set(appointment.patient_id, appointment);
    }
    const due = [...lastByPatient.values()].filter((a) => a.starts_at <= recentCutoff);
    if (due.length === 0) continue;

    const { data: upcoming, error: upcomingError } = await supabase
      .from('appointments')
      .select('patient_id')
      .eq('practice_id', practice.id)
      .in('patient_id', due.map((a) => a.patient_id))
      .gt('starts_at', new Date().toISOString())
      .not('status', 'in', '(cancelled)');
    if (upcomingError) {
      console.error(`Recall upcoming-appointments query failed for practice ${practice.id}:`, upcomingError.message);
      continue;
    }
    const hasUpcoming = new Set((upcoming ?? []).map((row) => row.patient_id as string));

    for (const appointment of due) {
      if (hasUpcoming.has(appointment.patient_id)) continue;
      const outcome = await sendAppointmentEmail(supabase, { appointmentId: appointment.id, templateKey: 'recall' });
      if (outcome.status === 'sent') sent++;
    }
  }

  return new Response(`Sent ${sent} recall email(s).`, { status: 200 });
});
