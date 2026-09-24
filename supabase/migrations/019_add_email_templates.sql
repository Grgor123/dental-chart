-- Customizable email templates + four new email types (cancellation,
-- reschedule, post-visit follow-up, recall), on top of migration 016's SES
-- plumbing.
--
-- Platform defaults for every template live in CODE
-- (supabase/functions/_shared/email/templateDefs.ts); this table only holds a
-- practice's OVERRIDES. No row (or a null column) = use the default, and
-- deleting a row is "reset to default". A practice edits the wording/timing,
-- never the layout shell, .ics attachment or unsubscribe footer.
--
-- New Edge Functions this depends on (deploy after running this):
--   - send-appointment-change-email   trigger-invoked below (cancelled/rescheduled)
--   - send-post-visit-emails          hourly cron below
--   - send-recall-emails              hourly cron below
--   - email-template-preview          called by the El. pošta editor (JWT ON)
-- and the existing send-appointment-confirmation-email /
-- send-appointment-reminder-emails must be redeployed (both were refactored
-- onto the shared helper; the reminder now gates per practice on its own
-- send hour instead of a single global 09:00).
begin;

-- ---- Per-practice template overrides ---------------------------------------

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  template_key text not null check (template_key in (
    'appointment_confirmation',
    'appointment_reminder',
    'appointment_cancelled',
    'appointment_rescheduled',
    'post_visit',
    'recall'
  )),
  -- Null = use the platform default for that field.
  subject text,
  heading text,
  body text,
  enabled boolean not null default true,
  -- Unit depends on template_key: reminder = days before the appointment,
  -- post_visit = hours after the appointment ends, recall = months since the
  -- last visit. Null = default. Immediate types (confirmation/cancelled/
  -- rescheduled) ignore it.
  timing_value integer check (timing_value is null or timing_value between 0 and 60),
  -- Europe/Ljubljana hour of day (reminder/recall only). Null = default.
  send_hour smallint check (send_hour is null or send_hour between 0 and 23),
  updated_at timestamptz not null default now(),
  unique (practice_id, template_key)
);

-- Like patients/therapists, no parent row to inherit practice_id from, so the
-- client sets it explicitly on insert (from usePracticeContext()) — no
-- auto-stamp trigger.
alter table public.email_templates enable row level security;
create policy email_templates_select on public.email_templates for select
  using (practice_id = public.current_practice_id());
create policy email_templates_insert on public.email_templates for insert
  with check (practice_id = public.current_practice_id());
create policy email_templates_update on public.email_templates for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy email_templates_delete on public.email_templates for delete
  using (practice_id = public.current_practice_id());

-- ---- email_log: new email types --------------------------------------------

alter table public.email_log drop constraint if exists email_log_email_type_check;
alter table public.email_log add constraint email_log_email_type_check check (email_type in (
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'post_visit',
  'recall'
));

-- An appointment can be moved more than once and each move deserves its own
-- email, so 'appointment_rescheduled' is the one type excluded from the
-- one-email-per-(appointment, type) dedup index. Every other type still
-- sends at most once per appointment (recall is keyed to the patient's last
-- completed appointment, so it's once per last visit).
drop index if exists public.email_log_appointment_id_email_type_idx;
create unique index email_log_appointment_id_email_type_idx
  on public.email_log(appointment_id, email_type)
  where appointment_id is not null and email_type <> 'appointment_rescheduled';

-- ---- Trigger: cancelled / rescheduled --------------------------------------

-- Same pg_net + Vault-secret pattern as send_appointment_confirmation_email()
-- (migration 016) — async, never blocks the update, silently no-ops if the
-- Vault secret isn't set. A status flip to 'cancelled' also happens when a
-- patient taps "Ne pridem" on the SMS confirm page, so that patient gets the
-- cancellation email too — intended (it's informational and confirms it).
create or replace function public.send_appointment_change_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_service_role_key text;
  v_kind text;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_kind := 'cancelled';
  elsif new.starts_at is distinct from old.starts_at
        and new.status <> 'cancelled'
        and new.starts_at > now() then
    v_kind := 'rescheduled';
  end if;

  if v_kind is null then
    return new;
  end if;

  select decrypted_secret into v_service_role_key
    from vault.decrypted_secrets where name = 'edge_function_service_role_key';

  if v_service_role_key is not null then
    perform net.http_post(
      url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/send-appointment-change-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role_key),
      body := jsonb_build_object('appointmentId', new.id, 'kind', v_kind)
    );
  end if;

  return new;
end;
$$;
create trigger send_appointment_change_email_trigger
  after update of status, starts_at on public.appointments
  for each row execute function public.send_appointment_change_email();

-- ---- Hourly crons: post-visit follow-up and recall -------------------------

-- Both run every hour and decide per practice inside the function (post-visit
-- is relative to each visit's end time; recall gates on each practice's own
-- send hour), so nothing here needs to know the timing settings.
select cron.schedule(
  'send-post-visit-emails-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/send-post-visit-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'send-recall-emails-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/send-recall-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

commit;

-- ============================================================================
-- SETUP NOTES — after running this:
--   supabase functions deploy send-appointment-confirmation-email
--   supabase functions deploy send-appointment-reminder-emails
--   supabase functions deploy send-appointment-change-email
--   supabase functions deploy send-post-visit-emails
--   supabase functions deploy send-recall-emails
--   supabase functions deploy email-template-preview
-- (all keep default JWT verification ON — the first five are trigger/cron
-- invoked with an explicit Bearer check, the last is called by a signed-in
-- browser session.) No new secrets.
--
-- Turning recall on for the first time only emails patients whose LAST
-- completed visit was between N and N+1 months ago (see the function's own
-- comment) — it never mass-emails years-old history.
-- ============================================================================
