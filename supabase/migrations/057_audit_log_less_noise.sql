-- Less noise in the audit log (Gregor, 2026-11-12). Two technical events of
-- the visit lifecycle are no longer logged:
--   * a visit being created — the app opens an empty visit every time a
--     patient's record is opened (and right after signing); it only matters
--     once something is recorded in it, and that is logged;
--   * a visit being closed (closed_at only) — happens on leaving the record.
-- Signing a visit, its record text and every chart change stay logged.
-- Only the trigger function changes; additive for every app version.
begin;

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
  if tg_table_name = 'visits' and tg_op = 'INSERT' then
    return null;  -- an empty visit being opened
  end if;
  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_row) n
     where n.value is distinct from (v_old -> n.key);
    if v_changed is null then
      return null;  -- nothing actually changed
    end if;
    if tg_table_name = 'visits' and v_changed <@ array['closed_at'] then
      return null;  -- the visit being closed on leaving the record
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

commit;
