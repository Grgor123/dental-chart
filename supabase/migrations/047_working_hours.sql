-- Working hours per team member (Gregor, 2026-10-22), set in Nastavitve →
-- Ekipa → "Delovni čas":
--   therapist_hours      weekly template: per weekday one or more periods
--                        (a split shift = two rows); with alternating weeks,
--                        separate rows for odd and even ISO weeks;
--   therapist_day_hours  a specific date's own periods — replace that date's
--                        weekly hours ("ročni popravek");
--   therapist_absences   dopust / bolniška / izobraževanje / drugo, from–to.
-- A date's hours: absence → none; else that date's own periods if any; else
-- the weekly template for its weekday (and week parity). No template at all
-- → the app assumes Mon–Fri 08:00–19:00 (lib/workingHours.ts).
--
-- Child tables of therapists: practice_id is stamped from the therapist row
-- (never trusted from the client). Reads: the whole practice; writes: owners.
-- Additive only (dev and main share this database).
begin;

alter table public.therapists
  add column alternating_weeks boolean not null default false;

create table public.therapist_hours (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  -- 'all' unless the therapist works alternating weeks ('odd' / 'even' ISO week).
  week_parity text not null default 'all' check (week_parity in ('all', 'odd', 'even')),
  weekday smallint not null check (weekday between 1 and 7), -- 1 = Monday (ISO)
  start_time time not null,
  end_time time not null,
  check (end_time > start_time),
  created_at timestamptz not null default now()
);
create index therapist_hours_therapist_idx on public.therapist_hours(therapist_id);

create table public.therapist_day_hours (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  check (end_time > start_time),
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now()
);
create index therapist_day_hours_therapist_date_idx on public.therapist_day_hours(therapist_id, date);

create table public.therapist_absences (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  date_from date not null,
  date_to date not null,
  check (date_to >= date_from),
  reason text not null default 'dopust' check (reason in ('dopust', 'bolniska', 'izobrazevanje', 'drugo')),
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now()
);
create index therapist_absences_therapist_idx on public.therapist_absences(therapist_id, date_from);

create or replace function public.set_practice_id_from_therapist()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  select practice_id into new.practice_id from public.therapists where id = new.therapist_id;
  if new.practice_id is null then
    raise exception 'Terapevt ne obstaja.';
  end if;
  return new;
end;
$$;

create trigger set_therapist_hours_practice_id before insert or update on public.therapist_hours
  for each row execute function public.set_practice_id_from_therapist();
create trigger set_therapist_day_hours_practice_id before insert or update on public.therapist_day_hours
  for each row execute function public.set_practice_id_from_therapist();
create trigger set_therapist_absences_practice_id before insert or update on public.therapist_absences
  for each row execute function public.set_practice_id_from_therapist();

alter table public.therapist_hours enable row level security;
alter table public.therapist_day_hours enable row level security;
alter table public.therapist_absences enable row level security;

create policy therapist_hours_select on public.therapist_hours for select
  using (practice_id = public.current_practice_id());
create policy therapist_hours_insert on public.therapist_hours for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy therapist_hours_update on public.therapist_hours for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy therapist_hours_delete on public.therapist_hours for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

create policy therapist_day_hours_select on public.therapist_day_hours for select
  using (practice_id = public.current_practice_id());
create policy therapist_day_hours_insert on public.therapist_day_hours for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy therapist_day_hours_update on public.therapist_day_hours for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy therapist_day_hours_delete on public.therapist_day_hours for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

create policy therapist_absences_select on public.therapist_absences for select
  using (practice_id = public.current_practice_id());
create policy therapist_absences_insert on public.therapist_absences for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy therapist_absences_update on public.therapist_absences for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy therapist_absences_delete on public.therapist_absences for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

commit;
