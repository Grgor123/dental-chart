-- Multi-tenancy foundation, part 1: new practice/practice_members tables,
-- auto-provisioning trigger, practice_id columns on every existing table
-- (backfilled from the one real practice), and auto-stamp triggers so
-- application code never has to know practice_id exists. Deliberately
-- leaves the OLD "auth_only" RLS policies in place — this file only adds
-- infrastructure, it does not start enforcing isolation yet. Verify the
-- backfill (e.g. `select count(*) from patients where practice_id is
-- null` returns 0) before running 012_replace_rls_policies.sql, which is
-- the file that actually flips enforcement on.
--
-- Run this once in the Supabase SQL Editor against the live "Dental
-- charting" project.
begin;

create table public.practices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Composite PK (not unique(user_id)) so a user could belong to more than
-- one practice later at zero schema cost — not meaningful today
-- (current_practice_id() below picks one via LIMIT 1), but the
-- invite/multi-practice-switcher UI that would make it meaningful is out
-- of scope for this pass.
create table public.practice_members (
  practice_id uuid not null references public.practices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (practice_id, user_id)
);
create index practice_members_user_id_idx on public.practice_members(user_id);

alter table public.practices enable row level security;
alter table public.practice_members enable row level security;

-- SECURITY DEFINER so it reads practice_members without re-triggering that
-- table's own RLS, and so it's safely callable from inside every other
-- table's RLS policy without cross-table RLS re-evaluation. search_path
-- pinned to close the classic SECURITY DEFINER search-path-hijack
-- privilege-escalation vector.
create or replace function public.current_practice_id()
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select practice_id from public.practice_members
  where user_id = auth.uid() limit 1
$$;
revoke all on function public.current_practice_id() from public;
grant execute on function public.current_practice_id() to authenticated;

-- Auto-provisioning: fires on every new auth.users row (self-serve signup
-- later, or Supabase dashboard "Add user" today) — atomic with account
-- creation, so a new login can never end up with no practice at all.
create or replace function public.handle_new_user_practice()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  new_practice_id uuid;
  practice_name text;
begin
  practice_name := coalesce(nullif(trim(new.raw_user_meta_data->>'practice_name'), ''), 'New practice');
  practice_name := left(practice_name, 200);
  insert into public.practices (name) values (practice_name) returning id into new_practice_id;
  insert into public.practice_members (practice_id, user_id, role) values (new_practice_id, new.id, 'owner');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_provision_practice on auth.users;
create trigger on_auth_user_created_provision_practice
  after insert on auth.users
  for each row execute function public.handle_new_user_practice();

-- SELECT-only for now. Deliberately NO insert/update/delete policy on
-- practice_members for authenticated users — a naive self-service insert
-- policy would let anyone add themselves to any practice_id they can
-- guess. All provisioning goes through the SECURITY DEFINER trigger above;
-- leave it that way until a real, validated invite flow exists.
create policy practices_select_own on public.practices
  for select using (id = public.current_practice_id());
create policy practice_members_select_own on public.practice_members
  for select using (user_id = auth.uid());

alter table public.patients add column practice_id uuid references public.practices(id);
alter table public.visits add column practice_id uuid references public.practices(id);
alter table public.tooth_records add column practice_id uuid references public.practices(id);
alter table public.treatment_entries add column practice_id uuid references public.practices(id);

-- Backfill: one real practice, BOTH existing accounts as owners (Monika's
-- own login and Gregor's, who has been testing against this same data all
-- along — backfilling only one would silently lock the other out).
do $$
declare
  v_practice_id uuid;
begin
  insert into public.practices (name) values ('Monikina ordinacija') returning id into v_practice_id;

  insert into public.practice_members (practice_id, user_id, role)
  select v_practice_id, u.id, 'owner' from auth.users u
  where u.email in ('goslar.monika@gmail.com', 'gregor.goslar@gmail.com');

  update public.patients set practice_id = v_practice_id where practice_id is null;
  update public.visits v set practice_id = p.practice_id from public.patients p
    where v.patient_id = p.id and v.practice_id is null;
  update public.tooth_records tr set practice_id = vi.practice_id from public.visits vi
    where tr.visit_id = vi.id and tr.practice_id is null;
  update public.treatment_entries te set practice_id = vi.practice_id from public.visits vi
    where te.visit_id = vi.id and te.practice_id is null;

  if exists (select 1 from public.patients where practice_id is null)
    or exists (select 1 from public.visits where practice_id is null)
    or exists (select 1 from public.tooth_records where practice_id is null)
    or exists (select 1 from public.treatment_entries where practice_id is null)
  then
    raise exception 'backfill incomplete: null practice_id remains somewhere';
  end if;
end $$;

alter table public.patients alter column practice_id set not null;
alter table public.visits alter column practice_id set not null;
alter table public.tooth_records alter column practice_id set not null;
alter table public.treatment_entries alter column practice_id set not null;

create index patients_practice_id_idx on public.patients(practice_id);
create index visits_practice_id_idx on public.visits(practice_id);
create index tooth_records_practice_id_idx on public.tooth_records(practice_id);
create index treatment_entries_practice_id_idx on public.treatment_entries(practice_id);

-- Auto-stamp triggers: derive practice_id from the parent row, so
-- useOpenVisit.ts / useVisit.ts never need to know practice_id exists at
-- all, and any client-supplied value is always overwritten by the real one
-- computed here (a buggy or malicious client can't smuggle a row into
-- another practice by attaching a fabricated practice_id).
create or replace function public.set_visit_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from public.patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  return new;
end;
$$;
create trigger set_visit_practice_id_trigger
  before insert or update of patient_id on public.visits
  for each row execute function public.set_visit_practice_id();

create or replace function public.set_tooth_record_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from public.visits where id = new.visit_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for visit %', new.visit_id; end if;
  return new;
end;
$$;
create trigger set_tooth_record_practice_id_trigger
  before insert or update of visit_id on public.tooth_records
  for each row execute function public.set_tooth_record_practice_id();

create or replace function public.set_treatment_entry_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from public.visits where id = new.visit_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for visit %', new.visit_id; end if;
  return new;
end;
$$;
create trigger set_treatment_entry_practice_id_trigger
  before insert or update of visit_id on public.treatment_entries
  for each row execute function public.set_treatment_entry_practice_id();

commit;
