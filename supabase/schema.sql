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
  perform seed_default_service_categories(new_practice_id);  -- starter price-list categories — see 020_add_price_list.sql
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
  email_bounced boolean not null default false,  -- hard-bounced address (migration 017) — shows "Preveri email naslov"; auto-cleared when email changes, see trigger below
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
  email_type text not null check (email_type in (
    'appointment_confirmation','appointment_reminder','appointment_cancelled',
    'appointment_rescheduled','post_visit','recall','health_questionnaire'
  )),
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
-- email_type); each type sends at most once per appointment — except
-- 'appointment_rescheduled', since an appointment can move more than once
-- (recall is keyed to the patient's last completed appointment, so it's once
-- per last visit).
create unique index email_log_appointment_id_email_type_idx
  on email_log(appointment_id, email_type)
  where appointment_id is not null and email_type <> 'appointment_rescheduled';
create index email_log_patient_id_idx on email_log(patient_id);
create index email_log_practice_id_idx on email_log(practice_id);

-- Per-practice email template OVERRIDES — see
-- supabase/migrations/019_add_email_templates.sql. Platform defaults live in
-- code (supabase/functions/_shared/email/templateDefs.ts); a null column or
-- no row at all means "use the default". Like patients/therapists, no parent
-- row to derive practice_id from, so the client sets it on insert.
create table email_templates (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),
  template_key text not null check (template_key in (
    'appointment_confirmation','appointment_reminder','appointment_cancelled',
    'appointment_rescheduled','post_visit','recall','health_questionnaire'
  )),
  subject text,
  heading text,
  body text,
  enabled boolean not null default true,
  -- reminder = days before, post_visit = hours after, recall = months; null = default
  timing_value integer check (timing_value is null or timing_value between 0 and 60),
  -- Europe/Ljubljana hour of day (reminder/recall only); null = default
  send_hour smallint check (send_hour is null or send_hour between 0 and 23),
  updated_at timestamptz not null default now(),
  unique (practice_id, template_key)
);

-- Health questionnaires (vprašalnik o zdravju) — see
-- supabase/migrations/021_add_health_questionnaires.sql. One row per
-- questionnaire sent; answers filled in once the patient submits. The
-- questions themselves live in code (supabase/functions/_shared/questionnaire.ts).
create table health_questionnaires (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped from patient_id
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,  -- null for a manual send
  token text not null unique,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  language text check (language in ('sl','en')),
  form_version smallint,
  answers jsonb,
  signature_name text,
  submitted_contact jsonb,      -- as the patient submitted it; staff apply differences by hand
  contact_applied_at timestamptz,
  reviewed_at timestamptz,      -- "Pregledano" (the paper form's "Inspected by")
  reviewed_by text,
  marketing_consent boolean,    -- the optional marketing checkbox, as submitted
  marketing_consent_text text,  -- the exact wording shown
  created_at timestamptz not null default now()
);
create index health_questionnaires_practice_id_idx on health_questionnaires(practice_id);
create index health_questionnaires_patient_id_idx on health_questionnaires(patient_id, sent_at desc);

create or replace function set_health_questionnaire_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  return new;
end;
$$;
create trigger set_health_questionnaire_practice_id_trigger
  before insert or update of patient_id on health_questionnaires
  for each row execute function set_health_questionnaire_practice_id();

-- Price list (Nastavitve → Cenik) — see supabase/migrations/020_add_price_list.sql.
-- Root tables like therapists: the client sets practice_id on insert.
create table service_categories (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (practice_id, name)
);
create index service_categories_practice_id_idx on service_categories(practice_id);

create table services (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),
  category_id uuid references service_categories(id) on delete restrict,  -- a category that still has services can't be deleted
  code text,  -- šifra
  name text not null,
  description text,
  price_eur numeric(10,2) not null check (price_eur >= 0),
  vat_rate numeric(4,1) not null default 0 check (vat_rate between 0 and 100),  -- percent; 0 = exempt (health services generally are in Slovenia)
  is_active boolean not null default true,  -- archive, never hard-delete: invoices will reference services
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index services_practice_code_idx
  on services(practice_id, lower(code)) where code is not null and code <> '';
create index services_practice_id_idx on services(practice_id);
create index services_category_id_idx on services(category_id);

-- A service may only point at a category of the SAME practice.
create or replace function check_service_category_practice()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.category_id is not null and not exists (
    select 1 from service_categories c
    where c.id = new.category_id and c.practice_id = new.practice_id
  ) then
    raise exception 'category does not belong to this practice';
  end if;
  return new;
end;
$$;
create trigger check_service_category_practice_trigger
  before insert or update of category_id, practice_id on services
  for each row execute function check_service_category_practice();

-- Starter categories every practice gets (called by handle_new_user_practice()
-- above); only seeds a practice that has none.
create or replace function seed_default_service_categories(p_practice_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from service_categories where practice_id = p_practice_id) then
    return;
  end if;
  insert into service_categories (practice_id, name, sort_order) values
    (p_practice_id, 'Preventiva', 10),
    (p_practice_id, 'Diagnostika in RTG', 20),
    (p_practice_id, 'Restavrativa', 30),
    (p_practice_id, 'Endodontija', 40),
    (p_practice_id, 'Parodontologija', 50),
    (p_practice_id, 'Kirurgija', 60),
    (p_practice_id, 'Implantologija', 70),
    (p_practice_id, 'Protetika', 80),
    (p_practice_id, 'Ortodontija', 90);
end;
$$;

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

-- When a bounced email address (email_bounced) is edited, clears the flag
-- AND re-enables sending (migrations 017/018) — a corrected address gets a
-- fresh chance. Safe because email_bounced is only set alongside an
-- automatic hard-bounce opt-out, so a patient who unsubscribed themselves
-- is never re-enabled by an address edit.
create or replace function reset_email_bounced_on_email_change()
returns trigger language plpgsql as $$
begin
  if new.email is distinct from old.email and old.email_bounced then
    new.email_bounced := false;
    new.email_opt_out := false;
    new.email_opt_out_at := null;
  end if;
  return new;
end;
$$;
create trigger reset_email_bounced_on_email_change_trigger
  before update of email on patients
  for each row execute function reset_email_bounced_on_email_change();

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

-- Trigger: email the patient when an appointment is cancelled or moved to a
-- new time — see supabase/migrations/019_add_email_templates.sql. Same
-- pg_net + Vault pattern as above. A 'cancelled' status flip also happens
-- when a patient taps "Ne pridem" on the SMS confirm page, so they get the
-- cancellation email too (intended).
create or replace function send_appointment_change_email()
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
  after update of status, starts_at on appointments
  for each row execute function send_appointment_change_email();

-- Trigger: send the health questionnaire when an appointment becomes
-- 'confirmed' (only if none in 12 months — rules in
-- supabase/functions/_shared/email/sendQuestionnaireEmail.ts) — see
-- supabase/migrations/022_questionnaire_on_confirmation.sql.
create or replace function send_questionnaire_on_confirmation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_service_role_key text;
begin
  if new.status <> 'confirmed' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' then
    return new;
  end if;

  select decrypted_secret into v_service_role_key
    from vault.decrypted_secrets where name = 'edge_function_service_role_key';

  if v_service_role_key is not null then
    perform net.http_post(
      url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/send-health-questionnaire',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role_key),
      body := jsonb_build_object('appointmentId', new.id)
    );
  end if;

  return new;
end;
$$;
create trigger send_questionnaire_on_confirmation_trigger
  after insert or update of status on appointments
  for each row execute function send_questionnaire_on_confirmation();

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

-- Hourly cron: send reminder EMAILS ahead of each appointment. Each practice
-- picks its own days-before and send hour (email_templates.timing_value/
-- send_hour, defaults 2 days / 09:00 Ljubljana — deliberately not SMS's
-- 14:00, so the two channels aren't coupled in time); the function gates
-- per practice. See CLAUDE.md's "Email notifications" section for why they're
-- fully separate functions.
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

-- Hourly crons: post-visit follow-up email (N hours after a completed
-- appointment ends) and recall email (N months after the last visit, no
-- upcoming appointment). Both decide per practice inside the function — see
-- supabase/migrations/019_add_email_templates.sql.
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

alter table email_templates enable row level security;
create policy email_templates_select on email_templates for select
  using (practice_id = current_practice_id());
create policy email_templates_insert on email_templates for insert
  with check (practice_id = current_practice_id());
create policy email_templates_update on email_templates for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy email_templates_delete on email_templates for delete
  using (practice_id = current_practice_id());

alter table service_categories enable row level security;
create policy service_categories_select on service_categories for select
  using (practice_id = current_practice_id());
create policy service_categories_insert on service_categories for insert
  with check (practice_id = current_practice_id());
create policy service_categories_update on service_categories for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy service_categories_delete on service_categories for delete
  using (practice_id = current_practice_id());

alter table services enable row level security;
create policy services_select on services for select
  using (practice_id = current_practice_id());
create policy services_insert on services for insert
  with check (practice_id = current_practice_id());
create policy services_update on services for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy services_delete on services for delete
  using (practice_id = current_practice_id());

alter table health_questionnaires enable row level security;
create policy health_questionnaires_select on health_questionnaires for select
  using (practice_id = current_practice_id());
create policy health_questionnaires_insert on health_questionnaires for insert
  with check (practice_id = current_practice_id());
create policy health_questionnaires_update on health_questionnaires for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy health_questionnaires_delete on health_questionnaires for delete
  using (practice_id = current_practice_id());

-- ---- Marketing consent ------------------------------------------------------
-- Explicit, optional opt-in for marketing messages (news, offers, preventive
-- check-up invitations) — separate from the transactional email/SMS consent,
-- which only covers appointment messages. Collected on the health
-- questionnaire as an unticked, optional checkbox; staff can only WITHDRAW it
-- (on the patient's request), never grant it, so every "true" traces back to
-- the patient ticking it themselves. Nothing sends marketing yet — the
-- planned tags/webhooks feature (CLAUDE.md) will only ever include patients
-- with marketing_consent = true.
alter table patients
  add column marketing_consent boolean not null default false,
  add column marketing_consent_at timestamptz,          -- when it was last granted or withdrawn
  add column marketing_consent_source text check (marketing_consent_source in ('questionnaire','staff')),
  add column marketing_consent_text text;               -- the exact wording the patient agreed to

-- ---- Invoicing (phase 1) --------------------------------------------------------
-- Baked in from supabase/migrations/023_add_invoicing.sql — see that file for
-- the full reasoning (gapless FURS-shaped numbering, immutable issued invoices,
-- storno via credit note).

-- ---- Issuer settings (Nastavitve → Podatki za račune) -------------------------
-- A separate table rather than columns on `practices`: practices only has a
-- select policy, and opening an update policy there would also expose the
-- email-domain columns. Root table, so the client sets practice_id.
create table public.invoice_settings (
  practice_id uuid primary key references public.practices(id),
  legal_name text,                 -- full legal name of the issuer
  address text,
  postal_code text,
  city text,                       -- also the "kraj izdaje" on the invoice
  tax_number text,                 -- davčna številka (8 digits; "SI" prefix printed for VAT payers)
  registration_number text,        -- matična številka
  vat_payer boolean not null default true,
  iban text,
  bank_name text,
  premise_code text not null default 'P1',  -- FURS business premise label (registered in phase 2)
  device_code text not null default 'B1',   -- FURS electronic device label
  vat_exempt_note text not null default 'Oproščeno plačila DDV po 2. točki 1. odstavka 42. člena ZDDV-1.',
  payment_due_days integer not null default 8 check (payment_due_days between 0 and 365),
  footer_note text,
  receipt_width_mm integer not null default 80 check (receipt_width_mm in (58, 80)),
  updated_at timestamptz not null default now()
);

alter table public.invoice_settings enable row level security;
create policy invoice_settings_select on public.invoice_settings for select
  using (practice_id = public.current_practice_id());
create policy invoice_settings_insert on public.invoice_settings for insert
  with check (practice_id = public.current_practice_id());
create policy invoice_settings_update on public.invoice_settings for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy invoice_settings_delete on public.invoice_settings for delete
  using (practice_id = public.current_practice_id());

-- ---- Sequences ------------------------------------------------------------------
-- RLS on with NO policies: only the security-definer issuing function below
-- ever reads or writes this, so a client can't skip or reuse a number.
create table public.invoice_sequences (
  practice_id uuid not null references public.practices(id),
  premise_code text not null,
  year integer not null,
  last_number integer not null,
  primary key (practice_id, premise_code, year)
);
alter table public.invoice_sequences enable row level security;

-- ---- Invoices ---------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),  -- auto-stamped from the patient row
  patient_id uuid not null references public.patients(id),    -- no cascade: issued invoices must outlive edits
  appointment_id uuid references public.appointments(id) on delete set null,
  kind text not null default 'invoice' check (kind in ('invoice','credit_note')),
  original_invoice_id uuid references public.invoices(id),    -- set on a credit note (storno)
  status text not null default 'draft' check (status in ('draft','issued')),
  -- Numbering — null while a draft, set once by issue_invoice().
  premise_code text,
  device_code text,
  year integer,
  sequence_number integer,
  number text,
  issued_at timestamptz,
  issued_by uuid references auth.users(id),
  issued_by_email text,
  service_date date not null default current_date,  -- datum opravljene storitve
  due_date date,
  payment_method text not null default 'cash' check (payment_method in ('cash','card','transfer')),
  paid_at timestamptz,
  cancelled_at timestamptz,        -- set on the ORIGINAL when it's cancelled by a credit note
  -- Snapshots taken at issue time, so a reprint years later is identical even
  -- if the patient's address or the practice's details change.
  issuer jsonb,
  buyer jsonb,
  total_eur numeric(12,2),
  vat_breakdown jsonb,             -- [{rate, gross, net, vat}], computed at issue
  note text,
  created_at timestamptz not null default now()
);
create unique index invoices_number_idx
  on public.invoices(practice_id, premise_code, year, sequence_number) where sequence_number is not null;
create index invoices_practice_id_idx on public.invoices(practice_id);
create index invoices_patient_id_idx on public.invoices(patient_id);
create index invoices_issued_at_idx on public.invoices(issued_at);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),  -- auto-stamped from the invoice row
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  position integer not null default 0,
  service_id uuid references public.services(id),
  -- Snapshots of the price-list row when the line was added.
  code text,
  name text not null,
  vat_rate numeric(4,1) not null default 0 check (vat_rate between 0 and 100),
  tooth_fdi text,
  quantity numeric(10,2) not null default 1 check (quantity <> 0),
  -- Final price per unit, VAT INCLUDED (price-list prices are final prices).
  unit_price_eur numeric(10,2) not null check (unit_price_eur >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  line_total_eur numeric(12,2) not null default 0,  -- always recomputed by the trigger below
  created_at timestamptz not null default now()
);
create index invoice_lines_invoice_id_idx on public.invoice_lines(invoice_id);
create index invoice_lines_practice_id_idx on public.invoice_lines(practice_id);

-- ---- Triggers: practice stamping + integrity ----------------------------------------

-- Every guard below can be bypassed only from inside issue/cancel (a
-- transaction-local flag that only those security-definer functions set —
-- set_config isn't reachable through the API).
create or replace function public.invoice_issuing_in_progress()
returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce(current_setting('app.invoice_issuing', true), '') = 'on';
$$;

create or replace function public.set_invoice_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from public.patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  if new.appointment_id is not null and not exists (
    select 1 from public.appointments a where a.id = new.appointment_id and a.practice_id = new.practice_id
  ) then
    raise exception 'appointment does not belong to this practice';
  end if;
  return new;
end;
$$;
create trigger set_invoice_practice_id_trigger
  before insert or update of patient_id, appointment_id on public.invoices
  for each row execute function public.set_invoice_practice_id();

-- Drafts are free; issued invoices are permanent. A client may only ever
-- create a plain draft, and may never issue one by hand (status/number are
-- set exclusively by issue_invoice()).
create or replace function public.guard_invoice()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'issued' then raise exception 'invoice_issued_immutable'; end if;
    return old;
  end if;

  if public.invoice_issuing_in_progress() then return new; end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.kind <> 'invoice' or new.original_invoice_id is not null
       or new.number is not null or new.sequence_number is not null or new.issued_at is not null
       or new.paid_at is not null or new.cancelled_at is not null then
      raise exception 'invoice_must_start_as_draft';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status = 'issued' then
    if (to_jsonb(new) - 'paid_at' - 'cancelled_at') is distinct from (to_jsonb(old) - 'paid_at' - 'cancelled_at') then
      raise exception 'invoice_issued_immutable';
    end if;
    if old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at then
      raise exception 'invoice_issued_immutable';
    end if;
    if old.cancelled_at is null and new.cancelled_at is not null then
      raise exception 'use_cancel_invoice';
    end if;
    return new;
  end if;

  -- A draft stays a draft with no number until issue_invoice() runs.
  if new.status <> 'draft' or new.kind is distinct from old.kind
     or new.original_invoice_id is distinct from old.original_invoice_id
     or new.number is not null or new.sequence_number is not null or new.issued_at is not null
     or new.paid_at is not null or new.cancelled_at is not null then
    raise exception 'use_issue_invoice';
  end if;
  return new;
end;
$$;
create trigger guard_invoice_trigger
  before insert or update or delete on public.invoices
  for each row execute function public.guard_invoice();

-- Lines: stamp practice_id from the invoice, block any change once the
-- invoice is issued, and recompute the line total server-side so the client
-- never decides an amount.
create or replace function public.prepare_invoice_line()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text;
  v_practice uuid;
begin
  if tg_op = 'DELETE' then
    select status into v_status from public.invoices where id = old.invoice_id;
    -- v_status is null while the parent itself is being deleted (cascade).
    if v_status = 'issued' then raise exception 'invoice_issued_immutable'; end if;
    return old;
  end if;

  select status, practice_id into v_status, v_practice from public.invoices where id = new.invoice_id;
  if v_practice is null then raise exception 'invoice not found'; end if;
  if v_status = 'issued' then raise exception 'invoice_issued_immutable'; end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then raise exception 'cannot move a line'; end if;
  if new.service_id is not null and not exists (
    select 1 from public.services s where s.id = new.service_id and s.practice_id = v_practice
  ) then
    raise exception 'service does not belong to this practice';
  end if;

  new.practice_id := v_practice;
  new.line_total_eur := round(new.quantity * new.unit_price_eur * (1 - new.discount_percent / 100), 2);
  return new;
end;
$$;
create trigger prepare_invoice_line_trigger
  before insert or update or delete on public.invoice_lines
  for each row execute function public.prepare_invoice_line();

-- ---- RLS ----------------------------------------------------------------------------
alter table public.invoices enable row level security;
create policy invoices_select on public.invoices for select
  using (practice_id = public.current_practice_id());
create policy invoices_insert on public.invoices for insert
  with check (practice_id = public.current_practice_id());
create policy invoices_update on public.invoices for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy invoices_delete on public.invoices for delete
  using (practice_id = public.current_practice_id());

alter table public.invoice_lines enable row level security;
create policy invoice_lines_select on public.invoice_lines for select
  using (practice_id = public.current_practice_id());
create policy invoice_lines_insert on public.invoice_lines for insert
  with check (practice_id = public.current_practice_id());
create policy invoice_lines_update on public.invoice_lines for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy invoice_lines_delete on public.invoice_lines for delete
  using (practice_id = public.current_practice_id());

-- ---- Issuing -----------------------------------------------------------------------

-- Internal: does the actual issuing, no caller check. Not callable through the
-- API (execute revoked below) — only from issue_invoice()/cancel_invoice().
create or replace function public.issue_invoice_internal(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv public.invoices;
  s public.invoice_settings;
  p public.patients;
  v_now timestamptz := now();
  v_year integer;
  v_number integer;
  v_total numeric(12,2);
  v_breakdown jsonb;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'invoice_not_found'; end if;
  if inv.status <> 'draft' then raise exception 'invoice_not_draft'; end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = inv.id) then
    raise exception 'invoice_no_lines';
  end if;

  select * into s from public.invoice_settings where practice_id = inv.practice_id;
  if s.practice_id is null or coalesce(trim(s.legal_name), '') = '' or coalesce(trim(s.tax_number), '') = '' then
    raise exception 'invoice_settings_incomplete';
  end if;
  select * into p from public.patients where id = inv.patient_id;

  perform set_config('app.invoice_issuing', 'on', true);

  -- Gapless: the upsert takes a row lock, so two invoices issued at the same
  -- moment on two computers queue up rather than share a number.
  v_year := extract(year from (v_now at time zone 'Europe/Ljubljana'))::integer;
  insert into public.invoice_sequences (practice_id, premise_code, year, last_number)
  values (inv.practice_id, s.premise_code, v_year, 1)
  on conflict (practice_id, premise_code, year)
    do update set last_number = public.invoice_sequences.last_number + 1
  returning last_number into v_number;

  -- Totals from the lines (line_total_eur is already server-computed).
  -- Prices include VAT: vat = gross * rate / (100 + rate).
  select coalesce(sum(line_total_eur), 0) into v_total from public.invoice_lines where invoice_id = inv.id;
  select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'gross', gross, 'vat', vat, 'net', gross - vat) order by rate), '[]'::jsonb)
    into v_breakdown
  from (
    select vat_rate as rate, sum(line_total_eur) as gross,
           round(sum(line_total_eur) * vat_rate / (100 + vat_rate), 2) as vat
    from public.invoice_lines where invoice_id = inv.id group by vat_rate
  ) g;

  update public.invoices set
    status = 'issued',
    premise_code = s.premise_code,
    device_code = s.device_code,
    year = v_year,
    sequence_number = v_number,
    number = s.premise_code || '-' || s.device_code || '-' || v_number,
    issued_at = v_now,
    issued_by = auth.uid(),
    issued_by_email = auth.jwt() ->> 'email',
    due_date = case when inv.payment_method = 'transfer'
                    then (v_now at time zone 'Europe/Ljubljana')::date + s.payment_due_days end,
    -- Cash/card are settled on the spot; so is a credit note.
    paid_at = case when inv.payment_method in ('cash','card') or inv.kind = 'credit_note' then v_now end,
    issuer = to_jsonb(s) - 'practice_id' - 'updated_at',
    buyer = coalesce(inv.buyer, jsonb_build_object(
      'name', trim(p.first_name || ' ' || p.last_name),
      'address', p.address,
      'postal_code', p.postal_code,
      'city', p.city)),
    total_eur = v_total,
    vat_breakdown = v_breakdown
  where id = inv.id;

  perform set_config('app.invoice_issuing', 'off', true);
end;
$$;

create or replace function public.issue_invoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.invoices where id = p_invoice_id and practice_id = public.current_practice_id()
  ) then
    raise exception 'invoice_not_found';
  end if;
  perform public.issue_invoice_internal(p_invoice_id);
end;
$$;

-- Storno: a credit note with every line negated, issued at once with its own
-- number, referencing the original; the original is marked cancelled.
-- Returns the credit note's id.
create or replace function public.cancel_invoice(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  orig public.invoices;
  v_new uuid;
begin
  select * into orig from public.invoices
  where id = p_invoice_id and practice_id = public.current_practice_id()
  for update;
  if orig.id is null then raise exception 'invoice_not_found'; end if;
  if orig.status <> 'issued' or orig.kind <> 'invoice' then raise exception 'invoice_not_cancellable'; end if;
  if orig.cancelled_at is not null then raise exception 'invoice_already_cancelled'; end if;

  perform set_config('app.invoice_issuing', 'on', true);

  insert into public.invoices (patient_id, appointment_id, kind, original_invoice_id, service_date, payment_method, buyer, note)
  values (orig.patient_id, orig.appointment_id, 'credit_note', orig.id, orig.service_date, orig.payment_method, orig.buyer,
          'Storno računa ' || orig.number)
  returning id into v_new;

  insert into public.invoice_lines (invoice_id, position, service_id, code, name, vat_rate, tooth_fdi, quantity, unit_price_eur, discount_percent)
  select v_new, position, service_id, code, name, vat_rate, tooth_fdi, -quantity, unit_price_eur, discount_percent
  from public.invoice_lines where invoice_id = orig.id;

  perform public.issue_invoice_internal(v_new);

  perform set_config('app.invoice_issuing', 'on', true);
  update public.invoices set cancelled_at = now() where id = orig.id;
  perform set_config('app.invoice_issuing', 'off', true);
  return v_new;
end;
$$;

revoke execute on function public.issue_invoice_internal(uuid) from public, anon, authenticated;
revoke execute on function public.issue_invoice(uuid) from public, anon;
revoke execute on function public.cancel_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated;
grant execute on function public.cancel_invoice(uuid) to authenticated;


-- ---- Invoice appearance -----------------------------------------------------------
-- Baked in from supabase/migrations/024_invoice_appearance.sql.

alter table public.invoice_settings
  add column logo_data_url text check (logo_data_url is null or length(logo_data_url) <= 700000),
  add column phone text,
  add column email text,
  add column website text,
  add column show_phone boolean not null default true,
  add column show_email boolean not null default true,
  add column show_website boolean not null default true;

alter table public.invoices
  add column buyer_tax_number text;

create or replace function public.issue_invoice_internal(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv public.invoices;
  s public.invoice_settings;
  p public.patients;
  v_now timestamptz := now();
  v_year integer;
  v_number integer;
  v_total numeric(12,2);
  v_breakdown jsonb;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'invoice_not_found'; end if;
  if inv.status <> 'draft' then raise exception 'invoice_not_draft'; end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = inv.id) then
    raise exception 'invoice_no_lines';
  end if;

  select * into s from public.invoice_settings where practice_id = inv.practice_id;
  if s.practice_id is null or coalesce(trim(s.legal_name), '') = '' or coalesce(trim(s.tax_number), '') = '' then
    raise exception 'invoice_settings_incomplete';
  end if;
  select * into p from public.patients where id = inv.patient_id;

  perform set_config('app.invoice_issuing', 'on', true);

  -- Gapless: the upsert takes a row lock, so two invoices issued at the same
  -- moment on two computers queue up rather than share a number.
  v_year := extract(year from (v_now at time zone 'Europe/Ljubljana'))::integer;
  insert into public.invoice_sequences (practice_id, premise_code, year, last_number)
  values (inv.practice_id, s.premise_code, v_year, 1)
  on conflict (practice_id, premise_code, year)
    do update set last_number = public.invoice_sequences.last_number + 1
  returning last_number into v_number;

  -- Totals from the lines (line_total_eur is already server-computed).
  -- Prices include VAT: vat = gross * rate / (100 + rate).
  select coalesce(sum(line_total_eur), 0) into v_total from public.invoice_lines where invoice_id = inv.id;
  select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'gross', gross, 'vat', vat, 'net', gross - vat) order by rate), '[]'::jsonb)
    into v_breakdown
  from (
    select vat_rate as rate, sum(line_total_eur) as gross,
           round(sum(line_total_eur) * vat_rate / (100 + vat_rate), 2) as vat
    from public.invoice_lines where invoice_id = inv.id group by vat_rate
  ) g;

  update public.invoices set
    status = 'issued',
    premise_code = s.premise_code,
    device_code = s.device_code,
    year = v_year,
    sequence_number = v_number,
    number = s.premise_code || '-' || s.device_code || '-' || v_number,
    issued_at = v_now,
    issued_by = auth.uid(),
    issued_by_email = auth.jwt() ->> 'email',
    due_date = case when inv.payment_method = 'transfer'
                    then (v_now at time zone 'Europe/Ljubljana')::date + s.payment_due_days end,
    -- Cash/card are settled on the spot; so is a credit note.
    paid_at = case when inv.payment_method in ('cash','card') or inv.kind = 'credit_note' then v_now end,
    -- The logo is left out of the snapshot (it's an image, and copying it into
    -- every invoice row would bloat the table); prints use the current logo.
    issuer = to_jsonb(s) - 'practice_id' - 'updated_at' - 'logo_data_url',
    buyer = coalesce(inv.buyer, jsonb_build_object(
      'name', trim(p.first_name || ' ' || p.last_name),
      'address', p.address,
      'postal_code', p.postal_code,
      'city', p.city,
      'tax_number', nullif(trim(inv.buyer_tax_number), ''))),
    total_eur = v_total,
    vat_breakdown = v_breakdown
  where id = inv.id;

  perform set_config('app.invoice_issuing', 'off', true);
end;
$$;

revoke execute on function public.issue_invoice_internal(uuid) from public, anon, authenticated;


-- ---- Invoices without a patient + editable payer --------------------------------
-- Baked in from supabase/migrations/025_invoice_payer.sql.

alter table public.invoices alter column patient_id drop not null;

create or replace function public.set_invoice_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.patient_id is not null then
    select practice_id into new.practice_id from public.patients where id = new.patient_id;
    if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  elsif new.practice_id is null then
    raise exception 'practice_id is required for an invoice without a patient';
  end if;
  if new.appointment_id is not null and not exists (
    select 1 from public.appointments a where a.id = new.appointment_id and a.practice_id = new.practice_id
  ) then
    raise exception 'appointment does not belong to this practice';
  end if;
  return new;
end;
$$;

create or replace function public.issue_invoice_internal(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv public.invoices;
  s public.invoice_settings;
  p public.patients;
  v_now timestamptz := now();
  v_year integer;
  v_number integer;
  v_total numeric(12,2);
  v_breakdown jsonb;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'invoice_not_found'; end if;
  if inv.status <> 'draft' then raise exception 'invoice_not_draft'; end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = inv.id) then
    raise exception 'invoice_no_lines';
  end if;

  select * into s from public.invoice_settings where practice_id = inv.practice_id;
  if s.practice_id is null or coalesce(trim(s.legal_name), '') = '' or coalesce(trim(s.tax_number), '') = '' then
    raise exception 'invoice_settings_incomplete';
  end if;
  select * into p from public.patients where id = inv.patient_id;
  -- A payer must be known: entered on the draft, or the linked patient.
  if coalesce(trim(inv.buyer ->> 'name'), '') = '' and p.id is null then
    raise exception 'invoice_no_buyer';
  end if;

  perform set_config('app.invoice_issuing', 'on', true);

  -- Gapless: the upsert takes a row lock, so two invoices issued at the same
  -- moment on two computers queue up rather than share a number.
  v_year := extract(year from (v_now at time zone 'Europe/Ljubljana'))::integer;
  insert into public.invoice_sequences (practice_id, premise_code, year, last_number)
  values (inv.practice_id, s.premise_code, v_year, 1)
  on conflict (practice_id, premise_code, year)
    do update set last_number = public.invoice_sequences.last_number + 1
  returning last_number into v_number;

  -- Totals from the lines (line_total_eur is already server-computed).
  -- Prices include VAT: vat = gross * rate / (100 + rate).
  select coalesce(sum(line_total_eur), 0) into v_total from public.invoice_lines where invoice_id = inv.id;
  select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'gross', gross, 'vat', vat, 'net', gross - vat) order by rate), '[]'::jsonb)
    into v_breakdown
  from (
    select vat_rate as rate, sum(line_total_eur) as gross,
           round(sum(line_total_eur) * vat_rate / (100 + vat_rate), 2) as vat
    from public.invoice_lines where invoice_id = inv.id group by vat_rate
  ) g;

  update public.invoices set
    status = 'issued',
    premise_code = s.premise_code,
    device_code = s.device_code,
    year = v_year,
    sequence_number = v_number,
    number = s.premise_code || '-' || s.device_code || '-' || v_number,
    issued_at = v_now,
    issued_by = auth.uid(),
    issued_by_email = auth.jwt() ->> 'email',
    due_date = case when inv.payment_method = 'transfer'
                    then (v_now at time zone 'Europe/Ljubljana')::date + s.payment_due_days end,
    -- Cash/card are settled on the spot; so is a credit note.
    paid_at = case when inv.payment_method in ('cash','card') or inv.kind = 'credit_note' then v_now end,
    -- The logo is left out of the snapshot (it's an image, and copying it into
    -- every invoice row would bloat the table); prints use the current logo.
    issuer = to_jsonb(s) - 'practice_id' - 'updated_at' - 'logo_data_url',
    buyer = coalesce(inv.buyer, jsonb_build_object(
      'name', trim(p.first_name || ' ' || p.last_name),
      'address', p.address,
      'postal_code', p.postal_code,
      'city', p.city,
      'tax_number', nullif(trim(inv.buyer_tax_number), ''))),
    total_eur = v_total,
    vat_breakdown = v_breakdown
  where id = inv.id;

  perform set_config('app.invoice_issuing', 'off', true);
end;
$$;

create or replace function public.cancel_invoice(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  orig public.invoices;
  v_new uuid;
begin
  select * into orig from public.invoices
  where id = p_invoice_id and practice_id = public.current_practice_id()
  for update;
  if orig.id is null then raise exception 'invoice_not_found'; end if;
  if orig.status <> 'issued' or orig.kind <> 'invoice' then raise exception 'invoice_not_cancellable'; end if;
  if orig.cancelled_at is not null then raise exception 'invoice_already_cancelled'; end if;

  perform set_config('app.invoice_issuing', 'on', true);

  insert into public.invoices (practice_id, patient_id, appointment_id, kind, original_invoice_id, service_date, payment_method, buyer, note)
  values (orig.practice_id, orig.patient_id, orig.appointment_id, 'credit_note', orig.id, orig.service_date, orig.payment_method, orig.buyer,
          'Storno računa ' || orig.number)
  returning id into v_new;

  insert into public.invoice_lines (invoice_id, position, service_id, code, name, vat_rate, tooth_fdi, quantity, unit_price_eur, discount_percent)
  select v_new, position, service_id, code, name, vat_rate, tooth_fdi, -quantity, unit_price_eur, discount_percent
  from public.invoice_lines where invoice_id = orig.id;

  perform public.issue_invoice_internal(v_new);

  perform set_config('app.invoice_issuing', 'on', true);
  update public.invoices set cancelled_at = now() where id = orig.id;
  perform set_config('app.invoice_issuing', 'off', true);
  return v_new;
end;
$$;

revoke execute on function public.issue_invoice_internal(uuid) from public, anon, authenticated;
revoke execute on function public.cancel_invoice(uuid) from public, anon;
grant execute on function public.cancel_invoice(uuid) to authenticated;


-- ---- Invoice email ------------------------------------------------------------------
-- Baked in from supabase/migrations/026_invoice_email.sql.

alter table public.email_log
  add column invoice_id uuid references public.invoices(id) on delete set null;
create index email_log_invoice_id_idx on public.email_log(invoice_id);

alter table public.email_log drop constraint if exists email_log_email_type_check;
alter table public.email_log add constraint email_log_email_type_check check (email_type in (
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'post_visit',
  'recall',
  'health_questionnaire',
  'invoice'
));

create or replace function public.set_email_log_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.appointment_id is not null then
    select practice_id into new.practice_id from public.appointments where id = new.appointment_id;
  elsif new.patient_id is not null then
    select practice_id into new.practice_id from public.patients where id = new.patient_id;
  elsif new.invoice_id is not null then
    select practice_id into new.practice_id from public.invoices where id = new.invoice_id;
  end if;
  if new.practice_id is null then
    raise exception 'cannot resolve practice_id for email_log row (need appointment_id, patient_id or invoice_id)';
  end if;
  return new;
end;
$$;
drop trigger if exists set_email_log_practice_id_trigger on public.email_log;
create trigger set_email_log_practice_id_trigger
  before insert or update of appointment_id, patient_id, invoice_id on public.email_log
  for each row execute function public.set_email_log_practice_id();


-- ---- Invoice email templates --------------------------------------------------------
-- Baked in from supabase/migrations/027_invoice_email_templates.sql.

alter table public.email_templates drop constraint if exists email_templates_template_key_check;
alter table public.email_templates add constraint email_templates_template_key_check check (template_key in (
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'post_visit',
  'recall',
  'health_questionnaire',
  'invoice',
  'credit_note'
));


-- ---- Default print format -----------------------------------------------------------
-- Baked in from supabase/migrations/028_default_print_format.sql.

alter table public.invoice_settings
  add column default_print_format text not null default 'a4'
    check (default_print_format in ('a4', 'receipt'));



-- ---- Unit (EM) per service --------------------------------------------------------
-- Baked in from supabase/migrations/029_service_unit.sql.
alter table public.services
  add column unit text not null default 'kos' check (length(trim(unit)) between 1 and 12);

alter table public.invoice_lines
  add column unit text not null default 'kos' check (length(trim(unit)) between 1 and 12);

-- Same as 025's version, plus the unit copied onto the credit note's lines.
create or replace function public.cancel_invoice(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  orig public.invoices;
  v_new uuid;
begin
  select * into orig from public.invoices
  where id = p_invoice_id and practice_id = public.current_practice_id()
  for update;
  if orig.id is null then raise exception 'invoice_not_found'; end if;
  if orig.status <> 'issued' or orig.kind <> 'invoice' then raise exception 'invoice_not_cancellable'; end if;
  if orig.cancelled_at is not null then raise exception 'invoice_already_cancelled'; end if;

  perform set_config('app.invoice_issuing', 'on', true);

  insert into public.invoices (practice_id, patient_id, appointment_id, kind, original_invoice_id, service_date, payment_method, buyer, note)
  values (orig.practice_id, orig.patient_id, orig.appointment_id, 'credit_note', orig.id, orig.service_date, orig.payment_method, orig.buyer,
          'Storno računa ' || orig.number)
  returning id into v_new;

  insert into public.invoice_lines (invoice_id, position, service_id, code, name, unit, vat_rate, tooth_fdi, quantity, unit_price_eur, discount_percent)
  select v_new, position, service_id, code, name, unit, vat_rate, tooth_fdi, -quantity, unit_price_eur, discount_percent
  from public.invoice_lines where invoice_id = orig.id;

  perform public.issue_invoice_internal(v_new);

  perform set_config('app.invoice_issuing', 'on', true);
  update public.invoices set cancelled_at = now() where id = orig.id;
  perform set_config('app.invoice_issuing', 'off', true);
  return v_new;
end;
$$;

revoke execute on function public.cancel_invoice(uuid) from public, anon;
grant execute on function public.cancel_invoice(uuid) to authenticated;


-- ---- Message text (Sporočila tab) -------------------------------------------------
-- Baked in from supabase/migrations/030_message_text.sql.

alter table public.email_log add column body_html text;
alter table public.appointment_reminders add column message_text text;
alter table public.patient_sms_consents add column message_text text;


-- ---- Realtime for the Sporočila tab ------------------------------------------------
-- Baked in from supabase/migrations/031_realtime_messages.sql.

alter publication supabase_realtime add table public.email_log, public.appointment_reminders, public.patient_sms_consents;


-- ---- FURS davčno potrjevanje --------------------------------------------------------
-- Baked in from supabase/migrations/032_furs_fiscalization.sql.

-- ---- User profile ----------------------------------------------------------
create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  practice_id uuid not null references public.practices(id),
  full_name text,
  tax_number text check (tax_number is null or tax_number ~ '^\d{8}$'),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
-- Only your own profile — colleagues don't see each other's tax numbers.
create policy user_profiles_select on public.user_profiles for select
  using (user_id = auth.uid() and practice_id = public.current_practice_id());
create policy user_profiles_insert on public.user_profiles for insert
  with check (user_id = auth.uid() and practice_id = public.current_practice_id());
create policy user_profiles_update on public.user_profiles for update
  using (user_id = auth.uid() and practice_id = public.current_practice_id())
  with check (user_id = auth.uid() and practice_id = public.current_practice_id());

-- ---- Business premise ------------------------------------------------------
create table public.furs_premises (
  practice_id uuid not null references public.practices(id),
  premise_code text not null,
  cadastral_number integer not null,
  building_number integer not null,
  building_section_number integer not null,
  street text not null,
  house_number text not null,
  house_number_additional text,
  community text not null,
  city text not null,
  postal_code text not null,
  validity_date date not null,
  -- Which FURS environment it is registered with ('test' / 'production'):
  -- switching environments needs a fresh registration.
  environment text not null check (environment in ('test', 'production')),
  registered_at timestamptz not null,
  registered_by uuid references auth.users(id),
  primary key (practice_id, premise_code)
);
alter table public.furs_premises enable row level security;
-- Read-only for the practice; only furs-register-premise (service role) writes.
create policy furs_premises_select on public.furs_premises for select
  using (practice_id = public.current_practice_id());

-- ---- Invoice FURS fields ---------------------------------------------------
alter table public.invoices
  -- null = not sent to FURS (bank transfer, or FURS not set up)
  add column furs_status text check (furs_status in ('pending', 'confirmed', 'failed')),
  add column furs_zoi text,
  add column furs_eor text,
  -- The 60-digit value of the FURS QR code printed on the invoice.
  add column furs_qr text,
  add column furs_operator_tax_number text,
  add column furs_error text,
  add column furs_attempts integer not null default 0,
  add column furs_last_attempt_at timestamptz,
  add column furs_confirmed_at timestamptz;
create index invoices_furs_pending_idx on public.invoices(furs_status) where furs_status = 'pending';

-- The one way to write FURS results onto an issued invoice (guard_invoice
-- otherwise rejects any change). Service role only — the Edge Function.
create or replace function public.record_invoice_furs(
  p_invoice_id uuid,
  p_status text,
  p_zoi text,
  p_eor text,
  p_qr text,
  p_operator_tax_number text,
  p_error text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('app.invoice_issuing', 'on', true);
  update public.invoices set
    furs_status = p_status,
    furs_zoi = coalesce(furs_zoi, p_zoi),  -- the ZOI never changes once set
    furs_eor = coalesce(p_eor, furs_eor),
    furs_qr = coalesce(furs_qr, p_qr),
    furs_operator_tax_number = coalesce(furs_operator_tax_number, p_operator_tax_number),
    furs_error = p_error,
    furs_attempts = furs_attempts + case when p_status = 'confirmed' or p_error is not null then 1 else 0 end,
    furs_last_attempt_at = case when p_status = 'confirmed' or p_error is not null then now() else furs_last_attempt_at end,
    furs_confirmed_at = case when p_status = 'confirmed' then now() else furs_confirmed_at end
  where id = p_invoice_id and status = 'issued';
  perform set_config('app.invoice_issuing', 'off', true);
end;
$$;
revoke execute on function public.record_invoice_furs(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_invoice_furs(uuid, text, text, text, text, text, text) to service_role;

-- ---- Retry: re-send invoices waiting for FURS ------------------------------
select cron.schedule(
  'fiscalize-pending-invoices',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/fiscalize-invoice',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key')
    ),
    body := '{"retryPending": true}'::jsonb
  );
  $$
);
