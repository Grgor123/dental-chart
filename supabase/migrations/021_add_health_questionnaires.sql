-- Health questionnaire (vprašalnik o zdravju) + marketing consent. Sent to a patient by email —
-- automatically when an appointment is booked (only if the patient has no
-- questionnaire submitted in the last 12 months) and by hand from the
-- Patient Record page ("Pošlji vprašalnik").
--
-- The questions themselves live in CODE
-- (supabase/functions/_shared/questionnaire.ts), shared by the patient-facing
-- page, the Edge Functions and the React app; this table stores one row per
-- questionnaire sent, holding the patient's answers once submitted.
--
-- Edge Functions this depends on (deploy after running this):
--   - health-questionnaire          PUBLIC (--no-verify-jwt), JSON API behind
--                                   docs/health-questionnaire.html
--   - send-health-questionnaire     called from the browser (JWT ON) for the
--                                   manual "Pošlji vprašalnik" button
--   - send-appointment-confirmation-email   REDEPLOY — it now also sends the
--                                   questionnaire on booking
--   - email-template-preview        REDEPLOY — knows the new template
begin;

create table public.health_questionnaires (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),  -- auto-stamped from patient_id, see trigger below
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,  -- the booking that triggered it; null for a manual send
  token text not null unique,                 -- the unguessable link token
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,            -- the link stops working after this (and once submitted)
  submitted_at timestamptz,                   -- null = sent, not yet filled in
  language text check (language in ('sl','en')),
  form_version smallint,                      -- questionnaire.ts FORM_VERSION the answers were given against
  answers jsonb,                              -- QuestionnaireAnswers (questionnaire.ts)
  signature_name text,                        -- the full name the patient typed as their signature
  -- Contact details as the patient submitted them (possibly corrected). Never
  -- written to `patients` automatically — staff review the differences on the
  -- Patient Record page and apply them with one click.
  submitted_contact jsonb,
  contact_applied_at timestamptz,             -- staff applied or dismissed the contact differences
  reviewed_at timestamptz,                    -- "Pregledano" — staff read the answers ("Inspected by" on the paper form)
  reviewed_by text,                           -- the reviewing staff member's login email
  created_at timestamptz not null default now()
);
create index health_questionnaires_practice_id_idx on public.health_questionnaires(practice_id);
create index health_questionnaires_patient_id_idx on public.health_questionnaires(patient_id, sent_at desc);

alter table public.health_questionnaires enable row level security;
create policy health_questionnaires_select on public.health_questionnaires for select
  using (practice_id = public.current_practice_id());
create policy health_questionnaires_insert on public.health_questionnaires for insert
  with check (practice_id = public.current_practice_id());
create policy health_questionnaires_update on public.health_questionnaires for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy health_questionnaires_delete on public.health_questionnaires for delete
  using (practice_id = public.current_practice_id());

create or replace function public.set_health_questionnaire_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from public.patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  return new;
end;
$$;
create trigger set_health_questionnaire_practice_id_trigger
  before insert or update of patient_id on public.health_questionnaires
  for each row execute function public.set_health_questionnaire_practice_id();

-- The questionnaire row is also the audit record of a marketing consent
-- given through it (what was shown, and whether it was ticked).
alter table public.health_questionnaires
  add column marketing_consent boolean,
  add column marketing_consent_text text;

-- ---- Marketing consent ------------------------------------------------------
-- Explicit, optional opt-in for marketing messages (news, offers, preventive
-- check-up invitations) — separate from the transactional email/SMS consent,
-- which only covers appointment messages. Collected on the health
-- questionnaire as an unticked, optional checkbox; staff can only WITHDRAW it
-- (on the patient's request), never grant it, so every "true" traces back to
-- the patient ticking it themselves. Nothing sends marketing yet — the
-- planned tags/webhooks feature (CLAUDE.md) will only ever include patients
-- with marketing_consent = true.
alter table public.patients
  add column marketing_consent boolean not null default false,
  add column marketing_consent_at timestamptz,          -- when it was last granted or withdrawn
  add column marketing_consent_source text check (marketing_consent_source in ('questionnaire','staff')),
  add column marketing_consent_text text;               -- the exact wording the patient agreed to

-- ---- New email type ---------------------------------------------------------

alter table public.email_templates drop constraint if exists email_templates_template_key_check;
alter table public.email_templates add constraint email_templates_template_key_check check (template_key in (
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'post_visit',
  'recall',
  'health_questionnaire'
));

alter table public.email_log drop constraint if exists email_log_email_type_check;
alter table public.email_log add constraint email_log_email_type_check check (email_type in (
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'post_visit',
  'recall',
  'health_questionnaire'
));
-- The existing (appointment_id, email_type) unique index already keeps the
-- automatic send to one per booking; a manual send has no appointment_id, so
-- it never collides with it.

commit;
