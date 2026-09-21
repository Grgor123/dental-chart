-- Native scheduling calendar — a real appointments table, scoped by
-- practice exactly like patients/visits already are. Follows the same
-- pattern as 011_add_multi_tenancy.sql/012_replace_rls_policies.sql:
-- practice_id is auto-stamped by a BEFORE INSERT/UPDATE trigger (copied
-- from set_visit_practice_id(), since appointments.patient_id is
-- structurally identical to visits.patient_id), never set by client code;
-- RLS is 4 explicit per-operation policies keyed on
-- practice_id = current_practice_id().
--
-- Status set deliberately narrower than the old Frame-5 mock's
-- (ni_termina/narocen/poslana_potrditev/potrjen/zavrnjen): those included
-- states only an automated online-booking/SMS flow could ever set, which
-- doesn't exist. Real set covers what a staff member actually does by
-- hand: scheduled (default) / confirmed / completed / cancelled / no_show.
--
-- Run this once in the Supabase SQL Editor against the live "Dental
-- charting" project.
begin;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),  -- auto-stamped, see trigger below
  patient_id uuid not null references public.patients(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'scheduled'
    check (status in ('scheduled','confirmed','completed','cancelled','no_show')),
  service text,  -- "Predvidena storitev" — free text; no services catalog exists yet
  notes text,
  created_at timestamptz not null default now()
);
create index appointments_practice_id_idx on public.appointments(practice_id);
create index appointments_patient_id_idx on public.appointments(patient_id);
create index appointments_starts_at_idx on public.appointments(starts_at);

alter table public.appointments enable row level security;

create or replace function public.set_appointment_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from public.patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  return new;
end;
$$;
create trigger set_appointment_practice_id_trigger
  before insert or update of patient_id on public.appointments
  for each row execute function public.set_appointment_practice_id();

create policy appointments_select on public.appointments for select
  using (practice_id = public.current_practice_id());
create policy appointments_insert on public.appointments for insert
  with check (practice_id = public.current_practice_id());
create policy appointments_update on public.appointments for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy appointments_delete on public.appointments for delete
  using (practice_id = public.current_practice_id());

commit;
