-- Dental Practice Management App — Phase 1 schema
-- Paste this whole file into the Supabase SQL Editor (Project → SQL Editor →
-- New query) and click Run. Safe to run once on a fresh project — this
-- already includes everything from migrations 001-016 baked in directly
-- (gum margin, bleeding surfaces, dental post, endo, visit lifecycle,
-- bridge grouping, restricting sex to M/F, patient contact fields, split
-- address fields, patient care fields, the multi-tenancy foundation:
-- practices/practice_members + practice_id on every table + real
-- per-practice RLS, a native appointments table, practice-scoped
-- therapists, SMS reminders/consent via Lertify, and email
-- notifications/opt-out via Amazon SES), so a brand-new
-- project only needs this ONE file, not this file plus sixteen migrations
-- run afterward in order. The migrations/
-- folder stays as-is for a project
-- that already has an OLDER version of these tables and needs to catch up
-- incrementally instead.
-- Source of truth: CLAUDE.md "Supabase Schema" section — keep both in sync.
--
-- NOTE: this fresh-project version has no existing data to backfill, so it
-- skips migration 011's backfill/not-null-afterward dance and just creates
-- practice_id as `not null` directly. It also has no "existing accounts to
-- link" step — the very first user to sign up (or be added via the
-- Supabase dashboard) gets their own practice via the same
-- handle_new_user_practice() trigger every later signup uses.

-- Practices (multi-tenancy) ------------------------------------------------
create table practices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Email notifications (see CLAUDE.md's "Email notifications" section /
  -- migrations/016_add_email_notifications.sql): contact_email is the
  -- Reply-To on outgoing email (falls back to the shared platform sending
  -- address if null). email_sending_mode starts 'platform_default' (zero
  -- setup, the shared verified domain) for every practice; 'custom_domain'
  -- is opt-in, provisioned by hand via scripts/provision-practice-domain.mjs
  -- (no in-app self-service flow yet — see that script's own header).
  contact_email text,
  email_sending_mode text not null default 'platform_default'
    check (email_sending_mode in ('platform_default','custom_domain')),
  custom_domain text,
  custom_domain_sender_local_part text not null default 'obvestila',
  custom_domain_verified boolean not null default false,
  custom_domain_dkim_tokens jsonb,  -- the 3 DKIM CNAME records SES returned, so DNS instructions can be regenerated from the DB alone
  custom_domain_requested_at timestamptz,
  custom_domain_verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- Composite PK (not unique(user_id)) so a user could belong to more than
-- one practice later at zero schema cost — not meaningful today
-- (current_practice_id() below picks one via LIMIT 1), but the
-- invite/multi-practice-switcher UI that would make it meaningful doesn't
-- exist yet.
create table practice_members (
  practice_id uuid not null references practices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (practice_id, user_id)
);
create index practice_members_user_id_idx on practice_members(user_id);

-- SECURITY DEFINER so it reads practice_members without re-triggering that
-- table's own RLS, and so it's safely callable from inside every other
-- table's RLS policy without cross-table RLS re-evaluation. search_path
-- pinned to close the classic SECURITY DEFINER search-path-hijack
-- privilege-escalation vector.
create or replace function current_practice_id()
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select practice_id from practice_members
  where user_id = auth.uid() limit 1
$$;
revoke all on function current_practice_id() from public;
grant execute on function current_practice_id() to authenticated;

-- Auto-provisioning: fires on every new auth.users row (self-serve signup
-- later, or Supabase dashboard "Add user" today) — atomic with account
-- creation, so a new login can never end up with no practice at all.
create or replace function handle_new_user_practice()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  new_practice_id uuid;
  practice_name text;
begin
  practice_name := coalesce(nullif(trim(new.raw_user_meta_data->>'practice_name'), ''), 'New practice');
  practice_name := left(practice_name, 200);
  insert into practices (name) values (practice_name) returning id into new_practice_id;
  insert into practice_members (practice_id, user_id, role) values (new_practice_id, new.id, 'owner');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_provision_practice on auth.users;
create trigger on_auth_user_created_provision_practice
  after insert on auth.users
  for each row execute function handle_new_user_practice();

-- Patients
create table patients (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),
  first_name text not null,
  last_name text not null,
  dob date not null,
  sex text check (sex in ('M','F')),  -- only two options offered, per Monika's explicit request — see migrations/007_restrict_sex_to_mf.sql for a project that already has the older 'other' value allowed
  phone text,
  email text,
  address text,        -- street + house number only — see postal_code/city below for the rest, per Monika's explicit request to split these
  postal_code text,
  city text,
  health_card_number text,  -- št. zdravstvene kartice (ZZZS) — captured for future use, not read anywhere in the app yet (eZdravje/ZZZS integration is a later phase — see CLAUDE.md's "Out of Scope for Phase 1")
  assigned_dentist text,          -- Izbran terapevt — plain editable text, not hardcoded (single-dentist assumption doesn't hold once other practices sign up)
  internal_record_number text,    -- Št. interne evidence — this practice's own internal patient record number
  diagnoses text[] default '{}',
  -- SMS reminders (see "Native scheduling calendar" / SMS section of
  -- CLAUDE.md) — a double opt-in: 'pending' the moment a phone number is
  -- set (request_sms_consent_on_phone_change_trigger below sends the
  -- one-button opt-in SMS), 'granted' only once that link is actually
  -- clicked. Appointment reminders never send to anyone but 'granted'.
  sms_consent_status text not null default 'unknown'
    check (sms_consent_status in ('unknown','pending','granted','declined')),
  sms_consent_requested_at timestamptz,
  sms_consent_responded_at timestamptz,
  -- Email notifications (see CLAUDE.md's "Email notifications" section) —
  -- a lighter-touch, opt-out model rather than SMS's double opt-in: an
  -- email on file is treated as implied consent, so this starts false
  -- (subscribed) with no separate request/grant step.
  -- email_unsubscribe_token is one persistent token per patient (not
  -- per-message like SMS's tokens), created lazily the first time an email
  -- actually goes out to them.
  email_opt_out boolean not null default false,
  email_opt_out_at timestamptz,
  email_unsubscribe_token text unique,
  created_at timestamptz default now()
);
create index patients_practice_id_idx on patients(practice_id);

-- Visits
create table visits (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped from the parent patient row, see set_visit_practice_id() below — application code never sets this directly
  patient_id uuid references patients(id) on delete cascade,
  date date not null,
  notes text,
  created_at timestamptz default now(),
  closed_at timestamptz  -- null = still open (dentist may still be actively working in it — see CLAUDE.md's "Visit lifecycle"); set once, never un-set
);
create index visits_practice_id_idx on visits(practice_id);

-- Tooth records per visit — ONE ROW PER TOOTH PER VISIT, not one shared row
-- per tooth overall. See CLAUDE.md's "Visit lifecycle" section: this is
-- what gives per-tooth chronological history for free (every row for one
-- tooth_id, ordered by its visit's date, IS that tooth's history) with no
-- separate event-log table. While a visit is open, the app upserts THIS
-- SAME row on every autosave flush (on the unique constraint below) rather
-- than inserting a new one each time; once the visit closes, its rows are
-- never written to again.
create table tooth_records (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped from the parent visit row, see set_tooth_record_practice_id() below — application code never sets this directly
  visit_id uuid references visits(id) on delete cascade,
  tooth_id text not null,           -- FDI: '11', '36', etc.
  surfaces jsonb not null default '{}',
  pockets_buccal int[] default '{0,0,0}',
  pockets_lingual int[] default '{0,0,0}',
  gum_margin_buccal int[] default '{0,0,0}',   -- signed mm from CEJ; negative = recession
  gum_margin_lingual int[] default '{0,0,0}',
  bleeding_buccal boolean[] default '{false,false,false}',   -- bleeding on probing (BOP)
  bleeding_lingual boolean[] default '{false,false,false}',
  furcation smallint default 0,
  mobility smallint default 0,
  endo text check (endo in ('planned','done','existing')),  -- endodontsko zdravljenje (kanal) — see ToothData.endo / EndoStage — supersedes the older unused `canal boolean` column
  post boolean default false,       -- zobni zatiček — see ToothData.post
  bridge_group_id text,             -- which explicit bridge this tooth belongs to, if any — see CLAUDE.md's "Bridge display" (bridgeGroupByFdi); not a foreign key, the id itself has no meaning beyond "these rows share the same value"
  notes text,
  created_at timestamptz default now()
);
create index tooth_records_practice_id_idx on tooth_records(practice_id);

-- Unique INDEX (not an inline `unique` column constraint) so this stays
-- consistent with migration 005_add_visit_lifecycle.sql's own `create
-- unique index if not exists` — see that file's comment for why.
create unique index if not exists tooth_records_visit_tooth_unique
  on tooth_records (visit_id, tooth_id);

-- Treatment plan entries
create table treatment_entries (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped from the parent visit row, see set_treatment_entry_practice_id() below — application code never sets this directly
  visit_id uuid references visits(id) on delete cascade,
  tooth_id text not null,
  surfaces text[],
  procedure text not null,
  price_eur numeric(8,2),
  status text check (status in ('planned','completed')) default 'planned',
  completed_date date,
  created_at timestamptz default now()
);
create index treatment_entries_practice_id_idx on treatment_entries(practice_id);

-- Appointments (native scheduling calendar) — status set is deliberately
-- narrower than an earlier UI mock's, which included states only an
-- automated online-booking/SMS flow could ever set; this covers what a
-- staff member actually does by hand.
create table appointments (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped from the parent patient row, see set_appointment_practice_id() below — application code never sets this directly
  patient_id uuid not null references patients(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'scheduled'
    check (status in ('scheduled','sent','confirmed','completed','cancelled','no_show')),
  service text,  -- "Predvidena storitev" — free text; no services catalog exists yet
  notes text,
  created_at timestamptz not null default now()
);
create index appointments_practice_id_idx on appointments(practice_id);
create index appointments_patient_id_idx on appointments(patient_id);
create index appointments_starts_at_idx on appointments(starts_at);

-- Terapevti (therapists) — practice-scoped calendar resources. Like
-- patients, a therapist has no parent row to derive practice_id from, so
-- the client sets it explicitly on insert rather than an auto-stamp
-- trigger deriving it.
create table therapists (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),
  name text not null,
  color text not null default '#2e6e62',  -- hex, used for the therapist's column header + their appointment chips
  created_at timestamptz not null default now()
);
create index therapists_practice_id_idx on therapists(practice_id);

alter table appointments add column therapist_id uuid references therapists(id) on delete set null;
create index appointments_therapist_id_idx on appointments(therapist_id);

-- SMS consent audit trail (patient_sms_consents) and appointment reminders
-- (appointment_reminders) — see supabase/migrations/015_add_sms_reminders.sql
-- and CLAUDE.md's SMS section for the full design (sent via Lertify, same
-- account as the sibling "dental calendar" booking-widget project).
create table patient_sms_consents (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped from the parent patient row
  patient_id uuid not null references patients(id) on delete cascade,
  consent_token text not null unique,
  consent_text text not null,  -- exact wording shown on the confirmation page
  requested_at timestamptz not null default now(),
  granted_at timestamptz
);
create index patient_sms_consents_patient_id_idx on patient_sms_consents(patient_id);

create table appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped from the parent appointment row
  appointment_id uuid not null references appointments(id) on delete cascade,
  patient_phone text not null,  -- E.164, copied at send time
  sent_at timestamptz not null default now(),
  lertify_message_id text,
  confirm_token text not null unique,
  status text not null default 'pending' check (status in ('pending','confirmed','declined')),
  replied_at timestamptz,
  delivery_status text check (delivery_status in ('SENT','DELIVERED','FAILED','REJECTED','UNKNOWN','CANCELLED'))
);
create unique index appointment_reminders_appointment_id_idx on appointment_reminders(appointment_id);

-- Email audit log — see supabase/migrations/016_add_email_notifications.sql
-- and CLAUDE.md's "Email notifications" section (sent via Amazon SES).
-- Generic on purpose (email_type, not a dedicated table per email type) so
-- a future email type needs only a new email_type value, not a new table.
create table email_log (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped from appointment_id (falling back to patient_id)
  patient_id uuid references patients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete cascade,
  email_type text not null check (email_type in ('appointment_confirmation','appointment_reminder')),
  recipient_email text not null,
  subject text not null,
  status text not null default 'sent' check (status in ('sent','delivered','bounced','complained','failed')),
  provider_message_id text,
  sender_domain text not null,  -- the shared platform domain, or a practice's own verified custom domain
  error_message text,
  sent_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A confirmation and a reminder for the same appointment coexist (different
-- email_type); a reminder can't be sent twice for the same appointment.
create unique index email_log_appointment_id_email_type_idx
  on email_log(appointment_id, email_type) where appointment_id is not null;
create index email_log_patient_id_idx on email_log(patient_id);
create index email_log_practice_id_idx on email_log(practice_id);

-- Auto-stamp triggers: derive practice_id from the parent row, so
-- useOpenVisit.ts / useVisit.ts never need to know practice_id exists at
-- all, and any client-supplied value is always overwritten by the real one
-- computed here (a buggy or malicious client can't smuggle a row into
-- another practice by attaching a fabricated practice_id).
create or replace function set_visit_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  return new;
end;
$$;
create trigger set_visit_practice_id_trigger
  before insert or update of patient_id on visits
  for each row execute function set_visit_practice_id();

create or replace function set_tooth_record_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from visits where id = new.visit_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for visit %', new.visit_id; end if;
  return new;
end;
$$;
create trigger set_tooth_record_practice_id_trigger
  before insert or update of visit_id on tooth_records
  for each row execute function set_tooth_record_practice_id();

create or replace function set_treatment_entry_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from visits where id = new.visit_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for visit %', new.visit_id; end if;
  return new;
end;
$$;
create trigger set_treatment_entry_practice_id_trigger
  before insert or update of visit_id on treatment_entries
  for each row execute function set_treatment_entry_practice_id();

create or replace function set_appointment_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  return new;
end;
$$;
create trigger set_appointment_practice_id_trigger
  before insert or update of patient_id on appointments
  for each row execute function set_appointment_practice_id();

create or replace function set_patient_sms_consent_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  return new;
end;
$$;
create trigger set_patient_sms_consent_practice_id_trigger
  before insert or update of patient_id on patient_sms_consents
  for each row execute function set_patient_sms_consent_practice_id();

create or replace function set_appointment_reminder_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from appointments where id = new.appointment_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for appointment %', new.appointment_id; end if;
  return new;
end;
$$;
create trigger set_appointment_reminder_practice_id_trigger
  before insert or update of appointment_id on appointment_reminders
  for each row execute function set_appointment_reminder_practice_id();

create or replace function set_email_log_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.appointment_id is not null then
    select practice_id into new.practice_id from appointments where id = new.appointment_id;
  elsif new.patient_id is not null then
    select practice_id into new.practice_id from patients where id = new.patient_id;
  end if;
  if new.practice_id is null then
    raise exception 'cannot resolve practice_id for email_log row (need appointment_id or patient_id)';
  end if;
  return new;
end;
$$;
create trigger set_email_log_practice_id_trigger
  before insert or update of appointment_id, patient_id on email_log
  for each row execute function set_email_log_practice_id();

-- Trigger: request SMS consent whenever a patient's phone is set/changes.
-- pg_net is Supabase's built-in async HTTP extension — this queues the
-- call as part of the same transaction (so it never fires if the write
-- rolls back) and returns immediately, never blocking a patient save. The
-- caller-auth secret is read from Supabase Vault by name, not embedded
-- here — see the SETUP NOTES at the bottom of
-- supabase/migrations/015_add_sms_reminders.sql for the one-time,
-- not-committed `vault.create_secret(...)` call this depends on.
create extension if not exists pg_net;

create or replace function request_sms_consent_on_phone_change()
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
    -- Hardcoded to this project's own URL rather than a Postgres runtime
    -- setting — Supabase doesn't reliably expose one for this. If this
    -- schema.sql is ever run fresh against a genuinely different Supabase
    -- project, update this URL (and the one in the cron job below) to
    -- match.
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
  before insert or update of phone on patients
  for each row execute function request_sms_consent_on_phone_change();

-- Trigger: send the confirmation email whenever an appointment is created —
-- see supabase/migrations/016_add_email_notifications.sql and CLAUDE.md's
-- "Email notifications" section. Same pg_net + Vault-secret pattern as
-- request_sms_consent_on_phone_change above, reusing the SAME
-- 'edge_function_service_role_key' Vault secret — no new secret needed.
create or replace function send_appointment_confirmation_email()
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
  after insert on appointments
  for each row execute function send_appointment_confirmation_email();

-- Daily cron: send reminders 2 days ahead. Requires the Supabase Pro plan
-- or above (pg_cron isn't on the Free tier) — if this fails, trigger
-- send-appointment-reminders from an external scheduler instead (same
-- Edge Function URL, same Authorization header). Fires hourly rather than
-- at one fixed UTC time, since 14:00 Europe/Ljubljana shifts between 12:00
-- and 13:00 UTC across daylight saving — send-appointment-reminders itself
-- checks the current Ljubljana wall-clock hour and no-ops unless it's 14.
create extension if not exists pg_cron;

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

-- Hourly cron: send reminder EMAILS 2 days ahead — same self-gating
-- pattern as the SMS cron above, but at a different hour (09:00 Ljubljana
-- vs. SMS's 14:00) purely so the two channels aren't coupled in time; see
-- CLAUDE.md's "Email notifications" section for why they're fully separate
-- functions.
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

-- Row Level Security — enable on all tables
alter table patients enable row level security;
alter table visits enable row level security;
alter table tooth_records enable row level security;
alter table treatment_entries enable row level security;
alter table appointments enable row level security;
alter table therapists enable row level security;

-- Policy: each practice can only see/write its own rows. Split into 4
-- explicit per-operation policies per table (not one "for all") so a
-- future tightening of one operation can never silently affect the other
-- three — see current_practice_id() above.
create policy patients_select on patients for select
  using (practice_id = current_practice_id());
create policy patients_insert on patients for insert
  with check (practice_id = current_practice_id());
create policy patients_update on patients for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy patients_delete on patients for delete
  using (practice_id = current_practice_id());

create policy visits_select on visits for select
  using (practice_id = current_practice_id());
create policy visits_insert on visits for insert
  with check (practice_id = current_practice_id());
create policy visits_update on visits for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy visits_delete on visits for delete
  using (practice_id = current_practice_id());

create policy tooth_records_select on tooth_records for select
  using (practice_id = current_practice_id());
create policy tooth_records_insert on tooth_records for insert
  with check (practice_id = current_practice_id());
create policy tooth_records_update on tooth_records for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy tooth_records_delete on tooth_records for delete
  using (practice_id = current_practice_id());

create policy treatment_entries_select on treatment_entries for select
  using (practice_id = current_practice_id());
create policy treatment_entries_insert on treatment_entries for insert
  with check (practice_id = current_practice_id());
create policy treatment_entries_update on treatment_entries for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy treatment_entries_delete on treatment_entries for delete
  using (practice_id = current_practice_id());

create policy appointments_select on appointments for select
  using (practice_id = current_practice_id());
create policy appointments_insert on appointments for insert
  with check (practice_id = current_practice_id());
create policy appointments_update on appointments for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy appointments_delete on appointments for delete
  using (practice_id = current_practice_id());

create policy therapists_select on therapists for select
  using (practice_id = current_practice_id());
create policy therapists_insert on therapists for insert
  with check (practice_id = current_practice_id());
create policy therapists_update on therapists for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy therapists_delete on therapists for delete
  using (practice_id = current_practice_id());

alter table patient_sms_consents enable row level security;
create policy patient_sms_consents_select on patient_sms_consents for select
  using (practice_id = current_practice_id());
create policy patient_sms_consents_insert on patient_sms_consents for insert
  with check (practice_id = current_practice_id());
create policy patient_sms_consents_update on patient_sms_consents for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy patient_sms_consents_delete on patient_sms_consents for delete
  using (practice_id = current_practice_id());

alter table appointment_reminders enable row level security;
create policy appointment_reminders_select on appointment_reminders for select
  using (practice_id = current_practice_id());
create policy appointment_reminders_insert on appointment_reminders for insert
  with check (practice_id = current_practice_id());
create policy appointment_reminders_update on appointment_reminders for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy appointment_reminders_delete on appointment_reminders for delete
  using (practice_id = current_practice_id());

alter table email_log enable row level security;
create policy email_log_select on email_log for select
  using (practice_id = current_practice_id());
create policy email_log_insert on email_log for insert
  with check (practice_id = current_practice_id());
create policy email_log_update on email_log for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy email_log_delete on email_log for delete
  using (practice_id = current_practice_id());
