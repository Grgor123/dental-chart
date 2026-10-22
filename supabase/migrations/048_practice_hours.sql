-- Clinic working hours (Gregor, 2026-10-22), set in Nastavitve → Delovni čas:
--   practice_hours        weekly periods (several per day = break);
--   practice_closed_days  dates the whole clinic is closed (holidays …);
--   practice_settings     block_outside_hours — staff can't book outside
--                         working hours (otherwise only a warning).
-- Clinic hours are also the fallback for team members without their own
-- (lib/workingHours.ts). Appointments get a source ('staff' | 'online'):
-- online bookings by patients are ALWAYS rejected outside clinic hours, staff
-- bookings only while block_outside_hours is on — enforced here by a trigger,
-- whatever page or app writes the row. The per-therapist hours check stays in
-- the app (staff are trusted; the clinic window is the hard rule).
-- Additive: no hours set → nothing is rejected, so main keeps working.
begin;

create table public.practice_hours (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  weekday smallint not null check (weekday between 1 and 7), -- 1 = Monday (ISO)
  start_time time not null,
  end_time time not null,
  check (end_time > start_time),
  created_at timestamptz not null default now()
);
create index practice_hours_practice_idx on public.practice_hours(practice_id);

create table public.practice_closed_days (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  date_from date not null,
  date_to date not null,
  check (date_to >= date_from),
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now()
);
create index practice_closed_days_practice_idx on public.practice_closed_days(practice_id, date_from);

create table public.practice_settings (
  practice_id uuid primary key references public.practices(id),
  block_outside_hours boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Root tables: the client sets practice_id. Everyone reads, owners write.
alter table public.practice_hours enable row level security;
alter table public.practice_closed_days enable row level security;
alter table public.practice_settings enable row level security;

create policy practice_hours_select on public.practice_hours for select
  using (practice_id = public.current_practice_id());
create policy practice_hours_insert on public.practice_hours for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy practice_hours_update on public.practice_hours for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy practice_hours_delete on public.practice_hours for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

create policy practice_closed_days_select on public.practice_closed_days for select
  using (practice_id = public.current_practice_id());
create policy practice_closed_days_insert on public.practice_closed_days for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy practice_closed_days_update on public.practice_closed_days for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy practice_closed_days_delete on public.practice_closed_days for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

create policy practice_settings_select on public.practice_settings for select
  using (practice_id = public.current_practice_id());
create policy practice_settings_insert on public.practice_settings for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy practice_settings_update on public.practice_settings for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy practice_settings_delete on public.practice_settings for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

alter table public.appointments
  add column source text not null default 'staff' check (source in ('staff', 'online'));

-- True when [p_start, p_end) lies inside one clinic period on one day
-- (Europe/Ljubljana time) and the clinic isn't closed that day. A practice
-- with no hours set accepts everything.
create or replace function public.within_practice_hours(p_practice_id uuid, p_start timestamptz, p_end timestamptz)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  ls timestamp := p_start at time zone 'Europe/Ljubljana';
  le timestamp := p_end at time zone 'Europe/Ljubljana';
begin
  if not exists (select 1 from public.practice_hours where practice_id = p_practice_id) then
    return true;
  end if;
  if ls::date <> (le - interval '1 microsecond')::date then
    return false; -- spans midnight
  end if;
  if exists (
    select 1 from public.practice_closed_days
    where practice_id = p_practice_id and ls::date between date_from and date_to
  ) then
    return false;
  end if;
  return exists (
    select 1 from public.practice_hours
    where practice_id = p_practice_id
      and weekday = extract(isodow from ls)
      and start_time <= ls::time
      and (case when le::time = time '00:00' then time '24:00' else le::time end) <= end_time
  );
end;
$$;
revoke all on function public.within_practice_hours(uuid, timestamptz, timestamptz) from public;

-- Runs before set_appointment_practice_id_trigger (alphabetical), so the
-- practice is read from the patient, not from new.practice_id.
create or replace function public.check_appointment_hours()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_practice uuid;
  v_block boolean;
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  select practice_id into v_practice from public.patients where id = new.patient_id;
  if v_practice is null or public.within_practice_hours(v_practice, new.starts_at, new.ends_at) then
    return new;
  end if;
  if new.source = 'online' then
    raise exception 'Termin je izven delovnega časa ambulante.' using errcode = 'P0001';
  end if;
  select block_outside_hours into v_block from public.practice_settings where practice_id = v_practice;
  if coalesce(v_block, false) then
    raise exception 'Naročanje izven delovnega časa ambulante ni mogoče.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger check_appointment_hours_trigger
  before insert or update of starts_at, ends_at, source on public.appointments
  for each row execute function public.check_appointment_hours();

commit;
