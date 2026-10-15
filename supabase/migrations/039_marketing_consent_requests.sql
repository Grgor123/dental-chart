-- "Pošlji soglasje" (Gregor, 2026-10-15): staff can ASK a patient for marketing
-- consent by email — a short email with one confirm button (double opt-in, like
-- the SMS consent). Staff still can never GIVE consent themselves: only the
-- patient's click on docs/marketing-consent.html sets marketing_consent = true
-- (source 'email'), which fires the consent_granted webhook (037/038).
--
-- Deploy after running this:
--   supabase functions deploy request-marketing-consent
--   supabase functions deploy marketing-consent-confirm --no-verify-jwt
begin;

create table public.marketing_consent_requests (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  token text not null unique,
  email text not null,
  consent_text text not null,       -- the exact wording the patient will confirm
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  confirmed_at timestamptz
);
create index marketing_consent_requests_patient_idx on public.marketing_consent_requests(patient_id);

alter table public.marketing_consent_requests enable row level security;
-- Read-only for the practice; only the Edge Functions write (service role).
create policy marketing_consent_requests_select on public.marketing_consent_requests for select
  using (practice_id = public.current_practice_id());

alter table public.patients drop constraint if exists patients_marketing_consent_source_check;
alter table public.patients add constraint patients_marketing_consent_source_check
  check (marketing_consent_source in ('questionnaire', 'staff', 'email', 'unsubscribe'));

-- Unsubscribing from email (staff "Odjavi", the patient's unsubscribe link, a
-- hard bounce) also withdraws marketing consent — someone who wants no email
-- wants no marketing (Gregor, 2026-10-15). Re-enabling email does NOT restore
-- it; that needs the patient's own confirmation ("Pošlji soglasje").
create or replace function public.withdraw_marketing_on_email_opt_out()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.email_opt_out and not coalesce(old.email_opt_out, false) and new.marketing_consent then
    new.marketing_consent := false;
    new.marketing_consent_at := now();
    new.marketing_consent_source := 'unsubscribe';
    new.marketing_consent_text := null;
  end if;
  return new;
end;
$$;

create trigger withdraw_marketing_on_email_opt_out_trigger
  before update of email_opt_out on public.patients
  for each row execute function public.withdraw_marketing_on_email_opt_out();

-- The webhook trigger (037/038) listened to "update OF marketing_consent",
-- which doesn't fire when a BEFORE trigger (above) changes the column. Listen
-- to every update instead; the function itself compares old and new.
drop trigger enqueue_webhook_consent_granted_trigger on public.patients;
create trigger enqueue_webhook_consent_granted_trigger
  after insert or update on public.patients
  for each row execute function public.enqueue_webhook_consent_granted();

alter table public.email_log drop constraint if exists email_log_email_type_check;
alter table public.email_log add constraint email_log_email_type_check check (email_type in (
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'post_visit',
  'recall',
  'health_questionnaire',
  'invoice',
  'aftercare',
  'marketing_consent'
));

commit;
