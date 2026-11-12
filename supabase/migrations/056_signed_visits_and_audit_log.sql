-- Signed visits and the audit log (Gregor, 2026-11-12; roadmap item 1).
--
-- 1. SIGNED VISITS. The dentist ends a visit with "Podpiši": the visit's
--    record (visits.notes, the "Zapis obiska") and every tooth_records row
--    of that visit are locked from then on — nothing, not even the service
--    role, can change or delete them. A correction is a visible addendum
--    (visit_addenda), which can't be changed or deleted either. Signing goes
--    through sign_visit() so who signed and when can't be faked.
--    Closed but unsigned visits stay as they were (editable in the database,
--    listed as "Nepodpisano" in the app until signed).
--
-- 2. AUDIT LOG. audit_log records who created, changed or deleted patient
--    data (database triggers — can't be skipped by the app) and who viewed,
--    printed or emailed it (log_patient_access(), called by the app). Rows
--    can't be changed or deleted by anyone; only owners can read their own
--    practice's log. Changed rows store the names of the changed fields,
--    never the values (the log must not become a second copy of the record).
--
-- Additive for older app versions: the only behaviour change they can see is
-- that a signed visit can't be written to, and they never sign.
begin;

-- ---------------------------------------------------------------- 1. Signing
alter table public.visits
  add column signed_at timestamptz,
  add column signed_by uuid references auth.users(id),
  add column signed_by_name text;

create index visits_unsigned_idx on public.visits(practice_id) where signed_at is null and closed_at is not null;

-- A signed visit never changes again; signing itself (signed_at null → set)
-- is the one allowed update.
create or replace function public.guard_signed_visit()
returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.signed_at is not null then
      raise exception 'Podpisanega obiska ni mogoče izbrisati.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.signed_at is not null then
    raise exception 'Obisk je podpisan in ga ni mogoče spreminjati — dodajte dopolnilo.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_signed_visit_trigger
  before update or delete on public.visits
  for each row execute function public.guard_signed_visit();

create or replace function public.guard_signed_tooth_record()
returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare
  v_visit uuid := case when tg_op = 'DELETE' then old.visit_id else new.visit_id end;
begin
  if exists (select 1 from public.visits where id = v_visit and signed_at is not null)
     or (tg_op = 'UPDATE' and exists (select 1 from public.visits where id = old.visit_id and signed_at is not null)) then
    raise exception 'Obisk je podpisan in ga ni mogoče spreminjati — dodajte dopolnilo.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger guard_signed_tooth_record_trigger
  before insert or update or delete on public.tooth_records
  for each row execute function public.guard_signed_tooth_record();

-- The signer's name as shown on the record: Moj profil name, else the login.
create or replace function public.current_user_display_name()
returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(trim((select full_name from public.user_profiles where user_id = auth.uid())), ''),
    (select email from auth.users where id = auth.uid())
  )
$$;
revoke all on function public.current_user_display_name() from public;

-- Signs a visit of the caller's practice: saves the visit record text, closes
-- the visit if still open, records who and when. Refuses an empty visit.
create or replace function public.sign_visit(p_visit_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_visit public.visits%rowtype;
  v_note text := nullif(trim(p_note), '');
begin
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or v_visit.practice_id is distinct from public.current_practice_id() then
    raise exception 'Obiska ni mogoče najti.' using errcode = '42501';
  end if;
  if v_visit.signed_at is not null then
    raise exception 'Obisk je že podpisan.' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 20000 then
    raise exception 'Zapis obiska je predolg.' using errcode = '22023';
  end if;
  if v_note is null and not exists (select 1 from public.tooth_records where visit_id = p_visit_id) then
    raise exception 'Obisk nima vpisov — ni česa podpisati.' using errcode = '22023';
  end if;
  update public.visits
     set notes = v_note,
         closed_at = coalesce(closed_at, now()),
         signed_at = now(),
         signed_by = auth.uid(),
         signed_by_name = public.current_user_display_name()
   where id = p_visit_id;
end;
$$;
revoke all on function public.sign_visit(uuid, text) from public;
grant execute on function public.sign_visit(uuid, text) to authenticated;

-- Addenda to a signed visit: append-only.
create table public.visit_addenda (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  visit_id uuid not null references public.visits(id),
  body text not null check (length(trim(body)) between 1 and 20000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_by_name text
);
create index visit_addenda_visit_id_idx on public.visit_addenda(visit_id);
alter table public.visit_addenda enable row level security;
create policy visit_addenda_select on public.visit_addenda for select
  using (practice_id = public.current_practice_id());
-- No insert/update/delete policies: add_visit_addendum() is the only way in.

create or replace function public.guard_visit_addendum()
returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  raise exception 'Dopolnila ni mogoče spreminjati ali izbrisati.' using errcode = '42501';
end;
$$;
create trigger guard_visit_addendum_trigger
  before update or delete on public.visit_addenda
  for each row execute function public.guard_visit_addendum();

create or replace function public.add_visit_addendum(p_visit_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_visit public.visits%rowtype;
  v_id uuid;
begin
  select * into v_visit from public.visits where id = p_visit_id;
  if not found or v_visit.practice_id is distinct from public.current_practice_id() then
    raise exception 'Obiska ni mogoče najti.' using errcode = '42501';
  end if;
  if v_visit.signed_at is null then
    raise exception 'Dopolnilo je mogoče dodati le podpisanemu obisku.' using errcode = '22023';
  end if;
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'Dopolnilo je prazno.' using errcode = '22023';
  end if;
  insert into public.visit_addenda (practice_id, visit_id, body, created_by, created_by_name)
  values (v_visit.practice_id, p_visit_id, trim(p_body), auth.uid(), public.current_user_display_name())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_visit_addendum(uuid, text) from public;
grant execute on function public.add_visit_addendum(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 2. Audit log
create table public.audit_log (
  id bigint generated always as identity primary key,
  practice_id uuid not null references public.practices(id),
  occurred_at timestamptz not null default now(),
  user_id uuid,
  -- The login's email, or 'sistem' for automatic work (reminders, online
  -- booking, delivery reports …).
  actor text not null,
  action text not null check (action in ('insert', 'update', 'delete', 'view', 'print', 'email', 'sign', 'addendum')),
  entity text not null,
  record_id text,
  patient_id uuid,
  details jsonb
);
create index audit_log_practice_time_idx on public.audit_log(practice_id, occurred_at desc);
create index audit_log_patient_idx on public.audit_log(practice_id, patient_id, occurred_at desc);
alter table public.audit_log enable row level security;
create policy audit_log_select on public.audit_log for select
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
-- No write policies: only the triggers and log_patient_access() below write.

create or replace function public.guard_audit_log()
returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  raise exception 'Revizijske sledi ni mogoče spreminjati ali brisati.' using errcode = '42501';
end;
$$;
create trigger guard_audit_log_trigger
  before update or delete on public.audit_log
  for each row execute function public.guard_audit_log();

create or replace function public.audit_actor()
returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((select email from auth.users where id = auth.uid()), 'sistem')
$$;
revoke all on function public.audit_actor() from public;

-- One trigger function for every audited table; it knows how each table
-- reaches its patient.
create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_changed text[];
  v_patient uuid;
  v_action text := lower(tg_op);
begin
  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_row) n
     where n.value is distinct from (v_old -> n.key);
    if v_changed is null then
      return null;  -- nothing actually changed
    end if;
    -- Signing is its own action, not a plain update.
    if tg_table_name = 'visits' and (v_old ->> 'signed_at') is null and (v_row ->> 'signed_at') is not null then
      v_action := 'sign';
    end if;
  end if;

  v_patient := case tg_table_name
    when 'patients' then (v_row ->> 'id')::uuid
    when 'tooth_records' then (select patient_id from public.visits where id = (v_row ->> 'visit_id')::uuid)
    when 'visit_addenda' then (select patient_id from public.visits where id = (v_row ->> 'visit_id')::uuid)
    else (v_row ->> 'patient_id')::uuid
  end;
  if tg_table_name = 'visit_addenda' then v_action := 'addendum'; end if;

  insert into public.audit_log (practice_id, user_id, actor, action, entity, record_id, patient_id, details)
  values (
    (v_row ->> 'practice_id')::uuid,
    auth.uid(),
    public.audit_actor(),
    v_action,
    tg_table_name,
    v_row ->> 'id',
    v_patient,
    case
      when tg_table_name = 'tooth_records' then jsonb_build_object('tooth', v_row ->> 'tooth_id', 'fields', to_jsonb(v_changed))
      when v_changed is not null then jsonb_build_object('fields', to_jsonb(v_changed))
    end
  );
  return null;
end;
$$;

create trigger audit_patients after insert or update or delete on public.patients
  for each row execute function public.audit_row_change();
create trigger audit_visits after insert or update or delete on public.visits
  for each row execute function public.audit_row_change();
create trigger audit_tooth_records after insert or update or delete on public.tooth_records
  for each row execute function public.audit_row_change();
create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function public.audit_row_change();
create trigger audit_health_questionnaires after insert or update or delete on public.health_questionnaires
  for each row execute function public.audit_row_change();
create trigger audit_invoices after insert or update or delete on public.invoices
  for each row execute function public.audit_row_change();
create trigger audit_visit_addenda after insert on public.visit_addenda
  for each row execute function public.audit_row_change();

-- Views, printouts and emails, reported by the app.
create or replace function public.log_patient_access(p_patient_id uuid, p_action text, p_details jsonb default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_practice uuid;
begin
  if p_action not in ('view', 'print', 'email') then
    raise exception 'Neznano dejanje.' using errcode = '22023';
  end if;
  select practice_id into v_practice from public.patients where id = p_patient_id;
  if v_practice is null or v_practice is distinct from public.current_practice_id() then
    raise exception 'Pacienta ni mogoče najti.' using errcode = '42501';
  end if;
  insert into public.audit_log (practice_id, user_id, actor, action, entity, record_id, patient_id, details)
  values (v_practice, auth.uid(), public.audit_actor(), p_action, 'patients', p_patient_id::text, p_patient_id,
          case when p_details is not null and length(p_details::text) <= 2000 then p_details end);
end;
$$;
revoke all on function public.log_patient_access(uuid, text, jsonb) from public;
grant execute on function public.log_patient_access(uuid, text, jsonb) to authenticated;

commit;
