-- Email notifications, sent via Amazon SES — appointment confirmation (with
-- an .ics attachment) on booking, and a reminder ahead of each appointment,
-- mirroring migration 015's SMS system but with a lighter-touch consent
-- model (implied consent + opt-out, not a double opt-in) and a genuinely
-- generic audit table (email_log) rather than one purpose-built table per
-- email type, since this is meant to be reusable plumbing for future email
-- types too, not just these first two.
--
-- Same reason as 015 for why this lives in Supabase Edge Functions rather
-- than a backend server: this app has none. The functions:
--   - send-appointment-confirmation-email   called by the trigger below
--                            whenever an appointment is inserted — sends
--                            the confirmation email + .ics attachment
--   - send-appointment-reminder-emails      hourly cron — the actual
--                            reminder, 2 days before each appointment,
--                            only to patients who haven't opted out
--   - email-unsubscribe      public page backend — one-click opt-out
--   - ses-bounce-webhook     public — SES (via SNS) bounce/complaint
--                            callback, auto opts out on a hard bounce or
--                            complaint
--
-- Custom sending domains per practice (see practices columns below) are
-- provisioned by hand via scripts/provision-practice-domain.mjs — there is
-- deliberately no in-app self-service flow yet (see that script's own
-- header, and CLAUDE.md's "Email notifications" section, for the reasoning
-- and the note that a real self-service Nastavitve page is future work).
--
-- Run this once in the Supabase SQL Editor against the live "Dental
-- charting" project, THEN see the setup notes at the bottom — nothing
-- actually sends until the AWS SES setup + Edge Functions + cron schedule
-- below are also in place.
begin;

-- ---- Email opt-out (patients) -------------------------------------------

alter table public.patients
  add column email_opt_out boolean not null default false,
  add column email_opt_out_at timestamptz,
  -- One persistent token per patient (unlike SMS's per-message
  -- consent_token/confirm_token) — an unsubscribe link only ever needs to
  -- prove "this is really that patient," not "this is really this specific
  -- message," so a single durable token that keeps working across every
  -- future email is simpler than minting one per send. Generated lazily by
  -- _shared/email/log.ts the first time an email actually goes out to a
  -- given patient, not eagerly on patient creation.
  add column email_unsubscribe_token text unique;

-- ---- Sending identity (practices) ----------------------------------------

alter table public.practices
  -- Reply-To on outgoing email — falls back to the shared platform sending
  -- address if null, so a missing value never breaks sending.
  add column contact_email text,
  -- 'platform_default': every practice's starting state, zero setup, sends
  -- from the one shared verified domain. 'custom_domain': this practice has
  -- its own domain provisioned (see below) — but the send helper always
  -- checks custom_domain_verified too, not just this mode, so a practice
  -- mid-verification (or one flipped to this mode before DNS actually
  -- propagated) silently falls back to the platform domain rather than
  -- sending from an unverified identity or failing outright.
  add column email_sending_mode text not null default 'platform_default'
    check (email_sending_mode in ('platform_default','custom_domain')),
  add column custom_domain text,
  add column custom_domain_sender_local_part text not null default 'obvestila',
  add column custom_domain_verified boolean not null default false,
  -- The 3 DKIM CNAME records SES hands back from CreateEmailIdentity, kept
  -- here so the DNS instructions can be regenerated from the database alone
  -- (e.g. to re-send them to a practice) without going back to the AWS
  -- console/CLI. Shape: [{ name, type, value }, ...].
  add column custom_domain_dkim_tokens jsonb,
  add column custom_domain_requested_at timestamptz,
  add column custom_domain_verified_at timestamptz;

-- ---- Email audit log -------------------------------------------------------

-- Generic on purpose — practice_id/patient_id/appointment_id are all
-- nullable except practice_id (every real trigger point this phase ships
-- is appointment-scoped, and appointments are already practice-scoped, so
-- there's no case needing practice_id nullable yet); a future email type
-- with no appointment involved just sets patient_id instead, or leaves both
-- null for a genuinely non-patient-scoped platform email later. Adding a
-- new email_type value is enough for a future email type — no new table.
create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),  -- auto-stamped, see trigger below
  patient_id uuid references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  email_type text not null check (email_type in ('appointment_confirmation','appointment_reminder')),
  recipient_email text not null,
  subject text not null,
  status text not null default 'sent' check (status in ('sent','delivered','bounced','complained','failed')),
  provider_message_id text,
  -- Which identity actually sent this: the shared platform domain, or a
  -- practice's own verified custom domain — useful for debugging
  -- deliverability per-domain later.
  sender_domain text not null,
  error_message text,
  sent_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A confirmation and a reminder for the same appointment coexist (different
-- email_type); a reminder can't be sent twice for the same appointment —
-- same dedup shape as appointment_reminders' own unique index in migration
-- 015, widened by email_type.
create unique index email_log_appointment_id_email_type_idx
  on public.email_log(appointment_id, email_type) where appointment_id is not null;
create index email_log_patient_id_idx on public.email_log(patient_id);
create index email_log_practice_id_idx on public.email_log(practice_id);

alter table public.email_log enable row level security;
create policy email_log_select on public.email_log for select
  using (practice_id = public.current_practice_id());
create policy email_log_insert on public.email_log for insert
  with check (practice_id = public.current_practice_id());
create policy email_log_update on public.email_log for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy email_log_delete on public.email_log for delete
  using (practice_id = public.current_practice_id());

create or replace function public.set_email_log_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.appointment_id is not null then
    select practice_id into new.practice_id from public.appointments where id = new.appointment_id;
  elsif new.patient_id is not null then
    select practice_id into new.practice_id from public.patients where id = new.patient_id;
  end if;
  if new.practice_id is null then
    raise exception 'cannot resolve practice_id for email_log row (need appointment_id or patient_id)';
  end if;
  return new;
end;
$$;
create trigger set_email_log_practice_id_trigger
  before insert or update of appointment_id, patient_id on public.email_log
  for each row execute function public.set_email_log_practice_id();

-- ---- Trigger: send confirmation email whenever an appointment is created --

-- Same pg_net + Vault-secret pattern as 015's
-- request_sms_consent_on_phone_change() — queued async inside this same
-- transaction (never fires if the insert rolls back), silently no-ops if
-- the Vault secret isn't set yet, and never blocks the appointment insert
-- itself. Reuses the SAME 'edge_function_service_role_key' Vault secret
-- 015 already depends on — no new secret needed.
create or replace function public.send_appointment_confirmation_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_service_role_key text;
begin
  select decrypted_secret into v_service_role_key
    from vault.decrypted_secrets where name = 'edge_function_service_role_key';

  if v_service_role_key is not null then
    perform net.http_post(
      url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/send-appointment-confirmation-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role_key),
      body := jsonb_build_object('appointmentId', new.id)
    );
  end if;

  return new;
end;
$$;
create trigger send_appointment_confirmation_email_trigger
  after insert on public.appointments
  for each row execute function public.send_appointment_confirmation_email();

-- ---- Hourly cron: send reminder emails 2 days ahead ----------------------

-- pg_net/pg_cron are already enabled by migration 015 — no re-declaration
-- needed. Deliberately a different hour than SMS's own 14:00 Ljubljana
-- reminder (see 015) purely so the two channels aren't coupled in time; an
-- SES outage/quota issue should never affect whether SMS reminders still go
-- out, and vice versa.
select cron.schedule(
  'send-appointment-reminder-emails-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/send-appointment-reminder-emails',
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
-- 1. AWS SES, one-time/account-wide (see CLAUDE.md's "Email notifications"
--    section for the full checklist): verify a sending domain, request SES
--    production access, create an IAM user scoped to
--    ses:SendEmail/ses:SendRawEmail, set up an SES configuration set with
--    Bounce/Complaint event publishing -> an SNS topic subscribed to the
--    deployed ses-bounce-webhook URL.
--
-- 2. Set the SES secrets once per project:
--
--      supabase secrets set SES_ACCESS_KEY_ID=<...> SES_SECRET_ACCESS_KEY=<...> SES_REGION=<...> SES_SENDER_ADDRESS=notifications@<verified-domain>
--
-- 3. Deploy the 4 new Edge Functions under supabase/functions/:
--    send-appointment-confirmation-email and send-appointment-reminder-emails
--    keep default JWT verification ON (trigger/cron-invoked only);
--    email-unsubscribe and ses-bounce-webhook must be deployed with
--    --no-verify-jwt (no signed-in caller — a patient clicking a link, or
--    AWS calling back).
--
-- 4. Add docs/email-unsubscribe.html to the existing GitHub Pages /docs
--    publish (same setup already enabled for the SMS pages — no new Pages
--    config needed, just the new file).
--
-- 5. Per-practice custom domains: run
--    `node scripts/provision-practice-domain.mjs --practice-id <id> --domain <domain>`
--    by hand when a practice wants its own sending domain — see that
--    script's own header for the full flow and its separate, broader-scoped
--    AWS credential requirement.
--
-- 6. Uses the SAME Vault secret 015 already set up
--    ('edge_function_service_role_key') — nothing new needed there.
