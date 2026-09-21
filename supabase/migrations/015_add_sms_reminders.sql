-- SMS appointment reminders + SMS consent (double opt-in), sent via
-- Lertify — the same SMS service/account as the sibling "dental calendar"
-- booking-widget project's own reminders (see that project's CLAUDE.md,
-- "SMS appointment reminders (Lertify)" section, for the pattern this
-- mirrors: a scheduled send, a one-tap confirm/decline page instead of an
-- SMS reply — Lertify's account here can't receive inbound SMS without
-- renting a two-way number — and an async delivery-status callback).
--
-- This app has no backend server (unlike the sibling project's Express
-- backend), so the actual sending/scheduling/confirm-page logic lives in
-- Supabase Edge Functions instead of n8n:
--   - request-sms-consent    called by the trigger below whenever a
--                            patient's phone is set/changed — sends the
--                            one-button opt-in SMS
--   - sms-consent-confirm    public page — the single "Da, želim prejemati
--                            SMS opomnike o terminih" button
--   - send-appointment-reminders   daily cron — the actual reminder, 2
--                            days before each appointment, only to
--                            patients whose consent is 'granted'
--   - appointment-confirm    public page — "Pridem / Ne pridem", updates
--                            appointments.status directly (the calendar's
--                            own tick/cross badges already read that
--                            column — no frontend change needed there)
--   - lertify-delivery-webhook   updates delivery_status async
--
-- Run this once in the Supabase SQL Editor against the live "Dental
-- charting" project, THEN see the setup notes at the bottom — nothing
-- actually sends until the Vault secret + Edge Functions + cron schedule
-- below are also in place.
begin;

-- ---- SMS consent (patients) --------------------------------------------

alter table public.patients
  add column sms_consent_status text not null default 'unknown'
    check (sms_consent_status in ('unknown','pending','granted','declined')),
  add column sms_consent_requested_at timestamptz,
  add column sms_consent_responded_at timestamptz;

-- Durable audit trail, separate from the fast-lookup columns above — same
-- reasoning as the sibling project's own `booking_consents` table: the
-- columns on `patients` can be edited/reset later (e.g. a new phone number
-- resets consent to 'pending' again, see the trigger below), so the actual
-- proof of consent — exact wording shown, exact timestamp — needs its own
-- append-only record, not just a mutable status column.
create table public.patient_sms_consents (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),  -- auto-stamped, see trigger below
  patient_id uuid not null references public.patients(id) on delete cascade,
  consent_token text not null unique,
  consent_text text not null,  -- exact wording shown on the confirmation page
  requested_at timestamptz not null default now(),
  granted_at timestamptz
);
create index patient_sms_consents_patient_id_idx on public.patient_sms_consents(patient_id);

alter table public.patient_sms_consents enable row level security;
create policy patient_sms_consents_select on public.patient_sms_consents for select
  using (practice_id = public.current_practice_id());
create policy patient_sms_consents_insert on public.patient_sms_consents for insert
  with check (practice_id = public.current_practice_id());
create policy patient_sms_consents_update on public.patient_sms_consents for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy patient_sms_consents_delete on public.patient_sms_consents for delete
  using (practice_id = public.current_practice_id());

create or replace function public.set_patient_sms_consent_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from public.patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  return new;
end;
$$;
create trigger set_patient_sms_consent_practice_id_trigger
  before insert or update of patient_id on public.patient_sms_consents
  for each row execute function public.set_patient_sms_consent_practice_id();

-- ---- SMS reminders (appointments) ---------------------------------------

create table public.appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),  -- auto-stamped, see trigger below
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_phone text not null,  -- E.164, copied at send time
  sent_at timestamptz not null default now(),
  lertify_message_id text,
  confirm_token text not null unique,
  status text not null default 'pending' check (status in ('pending','confirmed','declined')),
  replied_at timestamptz,
  delivery_status text check (delivery_status in ('SENT','DELIVERED','FAILED','REJECTED','UNKNOWN','CANCELLED'))
);
-- One reminder per appointment — send-appointment-reminders dedups against
-- this same uniqueness, same idea as the sibling project's own dedup
-- against `sms_reminders.calendar_event_id`.
create unique index appointment_reminders_appointment_id_idx on public.appointment_reminders(appointment_id);

alter table public.appointment_reminders enable row level security;
create policy appointment_reminders_select on public.appointment_reminders for select
  using (practice_id = public.current_practice_id());
create policy appointment_reminders_insert on public.appointment_reminders for insert
  with check (practice_id = public.current_practice_id());
create policy appointment_reminders_update on public.appointment_reminders for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy appointment_reminders_delete on public.appointment_reminders for delete
  using (practice_id = public.current_practice_id());

create or replace function public.set_appointment_reminder_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from public.appointments where id = new.appointment_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for appointment %', new.appointment_id; end if;
  return new;
end;
$$;
create trigger set_appointment_reminder_practice_id_trigger
  before insert or update of appointment_id on public.appointment_reminders
  for each row execute function public.set_appointment_reminder_practice_id();

-- ---- Trigger: request SMS consent whenever a patient's phone is set/changes --

-- pg_net is Supabase's built-in async HTTP extension — the call below just
-- queues the request (as part of this same transaction, so it never fires
-- if the transaction rolls back) and returns immediately; the actual HTTP
-- call happens in the background, so this never blocks a patient save.
create extension if not exists pg_net;

-- Reads the caller-auth secret from Supabase Vault by NAME rather than
-- embedding the real service-role key in this committed migration file —
-- see the setup notes at the bottom for the one-time (not committed)
-- `vault.create_secret(...)` call this depends on. If that secret hasn't
-- been created yet, this silently skips the consent request rather than
-- failing the patient write — a missing SMS-consent send should never
-- block staff from saving a patient's phone number.
create or replace function public.request_sms_consent_on_phone_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_service_role_key text;
begin
  if new.phone is null or trim(new.phone) = '' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.phone is not distinct from new.phone then
    return new;
  end if;

  select decrypted_secret into v_service_role_key
    from vault.decrypted_secrets where name = 'edge_function_service_role_key';

  new.sms_consent_status := 'pending';
  new.sms_consent_requested_at := now();
  new.sms_consent_responded_at := null;

  if v_service_role_key is not null then
    perform net.http_post(
      url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/request-sms-consent',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role_key),
      body := jsonb_build_object('patientId', new.id)
    );
  end if;

  return new;
end;
$$;
create trigger request_sms_consent_on_phone_change_trigger
  before insert or update of phone on public.patients
  for each row execute function public.request_sms_consent_on_phone_change();

-- ---- Daily cron: send reminders 2 days ahead -----------------------------

-- Requires the Supabase Pro plan or above — pg_cron isn't available on the
-- Free tier. If `create extension pg_cron` below fails for that reason,
-- skip it and trigger send-appointment-reminders from an external
-- scheduler instead (e.g. a free GitHub Actions cron workflow, or
-- cron-job.org) hitting the same Edge Function URL with the same
-- Authorization header — no code changes needed either way, only what
-- calls it on a schedule.
create extension if not exists pg_cron;

-- Fires every hour, not once at a fixed UTC time — 14:00 in
-- Europe/Ljubljana is 12:00 UTC in summer (CEST) and 13:00 UTC in winter
-- (CET), and pg_cron's schedule always runs in UTC with no timezone
-- awareness. Rather than hand-editing the cron expression twice a year for
-- daylight saving, send-appointment-reminders itself checks the current
-- Europe/Ljubljana wall-clock hour and no-ops unless it's actually 14 —
-- correct year-round, at the cost of 23 harmless no-op invocations a day.
select cron.schedule(
  'send-appointment-reminders-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/send-appointment-reminders',
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
-- SETUP NOTES — none of this is part of the transaction above; do it after.
-- ============================================================================
--
-- 1. Store the service-role key in Vault (run once, do NOT commit this
--    anywhere — paste your own key from Project Settings -> API):
--
--      select vault.create_secret('<paste the real service_role key>', 'edge_function_service_role_key');
--
--    If Vault isn't enabled yet: Database -> Extensions -> enable "vault".
--
-- 2. Deploy the 5 Edge Functions under supabase/functions/ (see each
--    folder's own README-style header comment for its exact deploy command
--    and required secrets) — `supabase login`, `supabase link --project-ref
--    aqubyxhudwxhfkhihgtk`, then `supabase functions deploy <name>` per
--    function. sms-consent-confirm, appointment-confirm, and
--    lertify-delivery-webhook must be deployed with --no-verify-jwt (they
--    have no signed-in user — a patient clicking an SMS link, or Lertify's
--    own server calling back).
--
-- 3. Set the Lertify secrets once per project:
--
--      supabase secrets set LERTIFY_API_KEY=<from the sibling project's backend/.env> LERTIFY_SENDER=<same file>
--
-- 4. If `create extension pg_cron` above failed (Free plan): set up an
--    external scheduler (GitHub Actions / cron-job.org) to POST to
--    https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/send-appointment-reminders
--    hourly, with `Authorization: Bearer <the service_role key>`.
