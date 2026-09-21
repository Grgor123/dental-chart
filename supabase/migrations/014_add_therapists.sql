-- Terapevti (therapists) — practice-scoped resources for the scheduling
-- calendar's day-view columns. Like `patients`, a therapist has no parent
-- row to derive practice_id from, so the client sets it explicitly on
-- insert (from usePracticeContext()) rather than an auto-stamp trigger.
--
-- appointments.therapist_id is nullable: existing appointments have none,
-- and an appointment can still be created without picking a therapist
-- (renders in a neutral "Neuvrščeno" column/grey chip).
--
-- Also widens appointments.status to add 'sent' (confirmation request
-- sent, awaiting reply) — part of the same Google-Calendar-style redesign.
--
-- Run this once in the Supabase SQL Editor against the live "Dental
-- charting" project.
begin;

create table public.therapists (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  name text not null,
  color text not null default '#2e6e62',  -- hex, used for the therapist's column header + their appointment chips
  created_at timestamptz not null default now()
);
create index therapists_practice_id_idx on public.therapists(practice_id);
alter table public.therapists enable row level security;

create policy therapists_select on public.therapists for select
  using (practice_id = public.current_practice_id());
create policy therapists_insert on public.therapists for insert
  with check (practice_id = public.current_practice_id());
create policy therapists_update on public.therapists for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy therapists_delete on public.therapists for delete
  using (practice_id = public.current_practice_id());

alter table public.appointments add column therapist_id uuid references public.therapists(id) on delete set null;
create index appointments_therapist_id_idx on public.appointments(therapist_id);

-- Google-Calendar-style redesign adds a 'sent' status (appointment
-- confirmation request sent to the patient, awaiting a reply) between
-- 'scheduled' and 'confirmed'. Widen the check constraint accordingly —
-- the auto-generated name from 013_add_appointments.sql's inline check is
-- "appointments_status_check".
alter table public.appointments drop constraint appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('scheduled','sent','confirmed','completed','cancelled','no_show'));

commit;
