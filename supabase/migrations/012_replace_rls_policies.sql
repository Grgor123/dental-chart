-- Multi-tenancy foundation, part 2: replace the old "auth_only" policies
-- (which let any authenticated user read/write every practice's data) with
-- real per-practice isolation, now that 011_add_multi_tenancy.sql has
-- backfilled a real practice_id onto every row.
--
-- Run this SECOND, only after confirming 011's backfill looks right, e.g.:
--   select count(*) from patients where practice_id is null;  -- must be 0
-- This is the file that actually starts enforcing isolation between
-- practices — from this point on, an authenticated user can only see rows
-- whose practice_id matches their own practice (current_practice_id()).
--
-- Run this once in the Supabase SQL Editor against the live "Dental
-- charting" project.
begin;

drop policy if exists "auth_only" on public.patients;
drop policy if exists "auth_only" on public.visits;
drop policy if exists "auth_only" on public.tooth_records;
drop policy if exists "auth_only" on public.treatment_entries;

-- Split into 4 explicit per-operation policies per table (not one "for
-- all") so a future tightening of one operation can never silently affect
-- the other three.

create policy patients_select on public.patients for select
  using (practice_id = public.current_practice_id());
create policy patients_insert on public.patients for insert
  with check (practice_id = public.current_practice_id());
create policy patients_update on public.patients for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy patients_delete on public.patients for delete
  using (practice_id = public.current_practice_id());

create policy visits_select on public.visits for select
  using (practice_id = public.current_practice_id());
create policy visits_insert on public.visits for insert
  with check (practice_id = public.current_practice_id());
create policy visits_update on public.visits for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy visits_delete on public.visits for delete
  using (practice_id = public.current_practice_id());

create policy tooth_records_select on public.tooth_records for select
  using (practice_id = public.current_practice_id());
create policy tooth_records_insert on public.tooth_records for insert
  with check (practice_id = public.current_practice_id());
create policy tooth_records_update on public.tooth_records for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy tooth_records_delete on public.tooth_records for delete
  using (practice_id = public.current_practice_id());

create policy treatment_entries_select on public.treatment_entries for select
  using (practice_id = public.current_practice_id());
create policy treatment_entries_insert on public.treatment_entries for insert
  with check (practice_id = public.current_practice_id());
create policy treatment_entries_update on public.treatment_entries for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy treatment_entries_delete on public.treatment_entries for delete
  using (practice_id = public.current_practice_id());

commit;
