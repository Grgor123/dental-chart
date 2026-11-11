-- Daily confirmation report (Gregor, 2026-11-11): at 17:00 Europe/Ljubljana,
-- after the 14:00 SMS reminder, an email to the practice listing the
-- appointments 2 days ahead — not answered (with the email/SMS delivery state
-- and phone), declined, confirmed. Same idea as the old booking widget's n8n
-- report. Edge Function send-reminder-report, set in Nastavitve → Delovni čas.
--   reminder_report_enabled   on unless switched off;
--   reminder_report_email     recipient — null = practices.contact_email;
--   reminder_report_last_sent once a day (the cron runs hourly).
-- Owners write through practice_settings' existing policies.
-- Additive: older app versions ignore the columns.
begin;

alter table public.practice_settings
  add column reminder_report_enabled boolean not null default true,
  add column reminder_report_email text
    check (reminder_report_email is null or reminder_report_email ~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$'),
  add column reminder_report_last_sent date;

-- Hourly, like the other email jobs; the function itself waits for 17:00
-- Ljubljana (pg_cron has no time zones).
select cron.schedule(
  'send-reminder-report-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := public.edge_function_url('send-reminder-report'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

commit;
