-- Online booking (Gregor, 2026-11-09) — roadmap item 6. A form embedded on
-- the practice's website (docs/online-booking.html on GitHub Pages, JSON API
-- in the public Edge Function `online-booking`) books straight into this
-- app's calendar:
--   online_booking_settings     per practice: on/off, the embed key, booking
--                               window, minimum notice, consent wording;
--   online_visit_types          what patients may book (name, duration);
--   online_visit_type_therapists who offers a type (none listed = everyone
--                               bookable);
--   online_booking_consents     audit record of the consent given per booking.
-- Patients are matched by name + (email or phone); no birth date is asked, so
-- patients.dob becomes optional (a new online patient has none until staff
-- add it) and patients.source marks where a patient record came from.
-- Additive: older app versions keep working (they never write a null dob).
begin;

alter table public.patients alter column dob drop not null;
alter table public.patients
  add column source text not null default 'staff' check (source in ('staff', 'online'));

create table public.online_booking_settings (
  practice_id uuid primary key references public.practices(id),
  enabled boolean not null default false,
  -- Public, unguessable id in the embed URL (?k=…); identifies the practice.
  public_key text not null unique default replace(gen_random_uuid()::text, '-', ''),
  booking_window_days smallint not null default 28 check (booking_window_days between 1 and 180),
  min_notice_hours smallint not null default 24 check (min_notice_hours between 0 and 336),
  slot_step_minutes smallint not null default 15 check (slot_step_minutes in (5, 10, 15, 20, 30, 60)),
  consent_text text check (consent_text is null or length(consent_text) <= 1000),
  privacy_policy_url text check (privacy_policy_url is null or privacy_policy_url ~ '^https://'),
  phone text check (phone is null or length(phone) <= 40), -- "pokličite nas" in the form
  updated_at timestamptz not null default now()
);

create table public.online_visit_types (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 300),
  duration_minutes smallint not null check (duration_minutes between 5 and 480),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index online_visit_types_practice_idx on public.online_visit_types(practice_id);

create table public.online_visit_type_therapists (
  visit_type_id uuid not null references public.online_visit_types(id) on delete cascade,
  therapist_id uuid not null references public.therapists(id) on delete cascade,
  practice_id uuid not null references public.practices(id),
  primary key (visit_type_id, therapist_id)
);

-- Both ends must belong to the inserting practice (same idea as
-- check_therapist_refs).
create or replace function public.check_online_visit_type_therapist()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.online_visit_types where id = new.visit_type_id and practice_id = new.practice_id)
     or not exists (select 1 from public.therapists where id = new.therapist_id and practice_id = new.practice_id) then
    raise exception 'Vrsta obiska in terapevt morata pripadati isti ordinaciji.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger check_online_visit_type_therapist_trigger
  before insert or update on public.online_visit_type_therapists
  for each row execute function public.check_online_visit_type_therapist();

alter table public.appointments
  add column online_visit_type_id uuid references public.online_visit_types(id) on delete set null;

-- Written only by the Edge Function (service role) — no client write policies.
create table public.online_booking_consents (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  patient_id uuid references public.patients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  consent_text text not null,
  privacy_policy_url text,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index online_booking_consents_practice_idx on public.online_booking_consents(practice_id, created_at);

-- Rate limiting for the public endpoint (hashed IP, no personal data).
-- Service role only.
create table public.online_booking_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  kind text not null check (kind in ('slots', 'book')),
  created_at timestamptz not null default now()
);
create index online_booking_attempts_ip_idx on public.online_booking_attempts(ip_hash, created_at);

alter table public.online_booking_settings enable row level security;
alter table public.online_visit_types enable row level security;
alter table public.online_visit_type_therapists enable row level security;
alter table public.online_booking_consents enable row level security;
alter table public.online_booking_attempts enable row level security; -- no policies

-- Everyone in the practice reads, owners write.
create policy online_booking_settings_select on public.online_booking_settings for select
  using (practice_id = public.current_practice_id());
create policy online_booking_settings_insert on public.online_booking_settings for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy online_booking_settings_update on public.online_booking_settings for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy online_booking_settings_delete on public.online_booking_settings for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

create policy online_visit_types_select on public.online_visit_types for select
  using (practice_id = public.current_practice_id());
create policy online_visit_types_insert on public.online_visit_types for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy online_visit_types_update on public.online_visit_types for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy online_visit_types_delete on public.online_visit_types for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

create policy online_visit_type_therapists_select on public.online_visit_type_therapists for select
  using (practice_id = public.current_practice_id());
create policy online_visit_type_therapists_insert on public.online_visit_type_therapists for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy online_visit_type_therapists_delete on public.online_visit_type_therapists for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

create policy online_booking_consents_select on public.online_booking_consents for select
  using (practice_id = public.current_practice_id());

-- Starter visit types (the current widget's two) for every existing practice.
insert into public.online_visit_types (practice_id, name, duration_minutes, sort_order)
select p.id, v.name, v.duration, v.sort_order
from public.practices p
cross join (values ('Pregled', 30, 10), ('Čiščenje zobnega kamna', 45, 20)) as v(name, duration, sort_order);

commit;
