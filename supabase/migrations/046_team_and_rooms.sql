-- Team and rooms (Gregor, 2026-10-22): therapists are managed in
-- Nastavitve → Ekipa instead of the calendar's "+", and a practice can list
-- its rooms (ordinacije — rooms/chairs inside one clinic, not separate
-- addresses). Booking a room per appointment comes later (roadmap item 5).
--
-- Additive only (dev and main still share this database): new columns, a new
-- table, and the therapists write policies narrowed to owners — both real
-- accounts are owners, so main's calendar "+" keeps working for them.
begin;

-- Ordinacije (rooms / chairs). Root table: the client sets practice_id.
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  name text not null check (length(trim(name)) between 1 and 60),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index rooms_practice_id_idx on public.rooms(practice_id);

alter table public.rooms enable row level security;
create policy rooms_select on public.rooms for select
  using (practice_id = public.current_practice_id());
create policy rooms_insert on public.rooms for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy rooms_update on public.rooms for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy rooms_delete on public.rooms for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

-- Team members. A therapist row is a person who treats or assists; a login
-- (practice_members) is optional and linked by user_id — reception has a login
-- but no row here, an assistant may have a row but no login.
alter table public.therapists
  add column title text check (title is null or length(title) <= 60),
  add column kind text not null default 'dentist'
    check (kind in ('dentist', 'specialist', 'hygienist', 'assistant')),
  add column user_id uuid references auth.users(id) on delete set null,
  add column room_id uuid references public.rooms(id) on delete set null,
  add column sort_order integer not null default 0,
  add column archived_at timestamptz;
create unique index therapists_practice_user_unique
  on public.therapists(practice_id, user_id) where user_id is not null;

-- A therapist's room and login must belong to the same practice
-- (practice_members is only readable row-by-own-row, hence security definer).
create or replace function public.check_therapist_refs()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.room_id is not null and not exists (
    select 1 from public.rooms where id = new.room_id and practice_id = new.practice_id
  ) then
    raise exception 'Ordinacija ne pripada tej ordinaciji.';
  end if;
  if new.user_id is not null and not exists (
    select 1 from public.practice_members where user_id = new.user_id and practice_id = new.practice_id
  ) then
    raise exception 'Uporabnik ni član te ordinacije.';
  end if;
  return new;
end;
$$;
create trigger check_therapist_refs_trigger
  before insert or update of room_id, user_id, practice_id on public.therapists
  for each row execute function public.check_therapist_refs();

drop policy therapists_insert on public.therapists;
drop policy therapists_update on public.therapists;
drop policy therapists_delete on public.therapists;
create policy therapists_insert on public.therapists for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy therapists_update on public.therapists for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy therapists_delete on public.therapists for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

-- "Izbran terapevt" on the patient record becomes a pick from the team. The
-- old free-text assigned_dentist stays (the app writes the name there too, so
-- older app versions still show it).
alter table public.patients
  add column assigned_therapist_id uuid references public.therapists(id) on delete set null;

create or replace function public.check_patient_therapist()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.assigned_therapist_id is not null and not exists (
    select 1 from public.therapists where id = new.assigned_therapist_id and practice_id = new.practice_id
  ) then
    raise exception 'Terapevt ne pripada tej ordinaciji.';
  end if;
  return new;
end;
$$;
create trigger check_patient_therapist_trigger
  before insert or update of assigned_therapist_id, practice_id on public.patients
  for each row execute function public.check_patient_therapist();

-- Backfill: link where the typed name matches exactly one therapist.
update public.patients p
set assigned_therapist_id = t.id
from public.therapists t
where p.assigned_therapist_id is null
  and p.assigned_dentist is not null
  and t.practice_id = p.practice_id
  and lower(trim(t.name)) = lower(trim(p.assigned_dentist))
  and (select count(*) from public.therapists t2
       where t2.practice_id = p.practice_id and lower(trim(t2.name)) = lower(trim(p.assigned_dentist))) = 1;

commit;
