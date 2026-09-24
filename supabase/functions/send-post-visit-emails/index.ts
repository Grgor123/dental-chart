// Deno Edge Function — the post-visit thank-you/follow-up email. Invoked
// hourly by pg_cron (supabase/migrations/019_add_email_templates.sql). Sends
// N hours (default 1, editable per practice in the El. pošta editor) after a
// COMPLETED appointment ends.
//
// This is time-after-visit, not invoice-driven — no invoicing exists yet (see
// CLAUDE.md "Out of Scope for Phase 1"); when it does, "invoice issued" can
// become an alternative trigger for the same template. An appointment marked
// completed late is still picked up as long as it ended within the last 48h,
// so old history is never emailed. Dedup is the email_log unique index via
// the shared helper, so the hourly re-scan of that window never double-sends.
//
// Deploy: supabase functions deploy send-post-visit-emails
// (keep default JWT verification ON — cron-invoked only.)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { loadAllOverrides, sendAppointmentEmail } from '../_shared/email/sendAppointmentEmail.ts';
import { effectiveSettings } from '../_shared/email/templateDefs.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const HOUR_MS = 3600000;
const LOOKBACK_HOURS = 48;

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { data: practices, error: practicesError } = await supabase.from('practices').select('id');
  if (practicesError) return new Response(`Query failed: ${practicesError.message}`, { status: 500 });
  const overrides = await loadAllOverrides(supabase, 'post_visit');

  const now = Date.now();
  let sent = 0;
  for (const practice of practices ?? []) {
    const settings = effectiveSettings('post_visit', overrides.get(practice.id) ?? null);
    if (!settings.enabled || settings.timingValue === null) continue;

    const endedBefore = new Date(now - settings.timingValue * HOUR_MS).toISOString();
    const endedAfter = new Date(now - LOOKBACK_HOURS * HOUR_MS).toISOString();

    const { data: appointments, error } = await supabase
      .from('appointments')
      .select('id')
      .eq('practice_id', practice.id)
      .eq('status', 'completed')
      .lte('ends_at', endedBefore)
      .gte('ends_at', endedAfter);
    if (error) {
      console.error(`Post-visit query failed for practice ${practice.id}:`, error.message);
      continue;
    }

    for (const appointment of appointments ?? []) {
      const outcome = await sendAppointmentEmail(supabase, { appointmentId: appointment.id, templateKey: 'post_visit' });
      if (outcome.status === 'sent') sent++;
    }
  }

  return new Response(`Sent ${sent} post-visit email(s).`, { status: 200 });
});
