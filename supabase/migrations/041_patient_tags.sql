-- Patient tags (oznake), Gregor's choices 2026-10-15:
--   - manual tags, created by each practice (Nastavitve → Oznake, or straight
--     on the patient record) — nothing hardcoded;
--   - automatic tags the app maintains itself:
--       category:<id>  issuing an invoice tags the patient with its services'
--                      price-list categories (e.g. "Implantologija");
--       new_patient    "Nov pacient" — first visit within the last 90 days;
--       inactive_12m   "Brez obiska 12 mesecev" — last visit over a year ago and
--                      nothing booked;
--     a "visit" = a chart visit with something recorded, or a completed
--     appointment (opening a chart alone doesn't count). The two activity tags
--     are recalculated daily (pg_cron 03:00 UTC) and come and go by themselves;
--   - per tag "share_externally" (default OFF, owners only): only such tags
--     ever leave the app — in webhook payloads and as tag_added / tag_removed
--     events, and only for patients with marketing consent. Category tags are
--     health information, so they stay inside unless an owner decides
--     otherwise.
--
-- Redeploy after running this: supabase functions deploy deliver-webhooks
begin;

-- ---- Tables ---------------------------------------------------------------------

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  name text not null check (length(trim(name)) between 1 and 60),
  kind text not null default 'manual' check (kind in ('manual', 'auto')),
  auto_rule text,  -- 'category:<uuid>' | 'new_patient' | 'inactive_12m' (auto only)
  share_externally boolean not null default false,
  created_at timestamptz not null default now(),
  check ((kind = 'auto') = (auto_rule is not null))
);
create index tags_practice_id_idx on public.tags(practice_id);
create unique index tags_manual_name_unique on public.tags(practice_id, lower(trim(name))) where kind = 'manual';
create unique index tags_auto_rule_unique on public.tags(practice_id, auto_rule) where auto_rule is not null;

create table public.patient_tags (
  patient_id uuid not null references public.patients(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  practice_id uuid not null references public.practices(id),
  source text not null default 'manual' check (source in ('manual', 'auto')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (patient_id, tag_id)
);
create index patient_tags_tag_id_idx on public.patient_tags(tag_id);
create index patient_tags_practice_id_idx on public.patient_tags(practice_id);

-- practice_id from the patient (never trusted from the client); the tag must
-- belong to the same practice.
create or replace function public.set_patient_tag_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from public.patients where id = new.patient_id;
  if new.practice_id is null then
    raise exception 'patient_not_found';
  end if;
  if not exists (select 1 from public.tags where id = new.tag_id and practice_id = new.practice_id) then
    raise exception 'tag_not_in_practice';
  end if;
  return new;
end;
$$;
create trigger set_patient_tag_practice_id_trigger
  before insert on public.patient_tags
  for each row execute function public.set_patient_tag_practice_id();

-- Auto tags: name follows the rule, not editable; sharing is the owner's call.
create or replace function public.guard_tag_changes()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_setting('app.tags_system', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.kind <> 'manual' then raise exception 'auto_tags_are_system_managed'; end if;
    if new.share_externally and public.current_practice_role() is distinct from 'owner' then
      raise exception 'only_owner_can_share_tags';
    end if;
    return new;
  end if;
  if new.kind <> old.kind or new.auto_rule is distinct from old.auto_rule or new.practice_id <> old.practice_id then
    raise exception 'tag_kind_immutable';
  end if;
  if old.kind = 'auto' and new.name <> old.name then
    raise exception 'auto_tag_name_immutable';
  end if;
  if new.share_externally <> old.share_externally and public.current_practice_role() is distinct from 'owner' then
    raise exception 'only_owner_can_share_tags';
  end if;
  return new;
end;
$$;
create trigger guard_tag_changes_trigger
  before insert or update on public.tags
  for each row execute function public.guard_tag_changes();

-- ---- RLS ------------------------------------------------------------------------

alter table public.tags enable row level security;
create policy tags_select on public.tags for select
  using (practice_id = public.current_practice_id());
create policy tags_insert on public.tags for insert
  with check (practice_id = public.current_practice_id());
create policy tags_update on public.tags for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy tags_delete on public.tags for delete
  using (practice_id = public.current_practice_id() and kind = 'manual');

alter table public.patient_tags enable row level security;
create policy patient_tags_select on public.patient_tags for select
  using (practice_id = public.current_practice_id());
-- Staff set and remove MANUAL tags only; auto tags belong to the rules.
create policy patient_tags_insert on public.patient_tags for insert
  with check (
    practice_id = public.current_practice_id() and source = 'manual'
    and exists (select 1 from public.tags t where t.id = tag_id and t.kind = 'manual')
  );
create policy patient_tags_delete on public.patient_tags for delete
  using (
    practice_id = public.current_practice_id()
    and exists (select 1 from public.tags t where t.id = tag_id and t.kind = 'manual')
  );

-- ---- Automatic tags ---------------------------------------------------------------

create or replace function public.ensure_auto_tag(p_practice_id uuid, p_rule text, p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  perform set_config('app.tags_system', 'on', true);
  insert into public.tags (practice_id, name, kind, auto_rule)
  values (p_practice_id, p_name, 'auto', p_rule)
  on conflict (practice_id, auto_rule) where auto_rule is not null
  do update set name = excluded.name
  returning id into v_id;
  perform set_config('app.tags_system', 'off', true);
  return v_id;
end;
$$;
revoke execute on function public.ensure_auto_tag(uuid, text, text) from public, anon, authenticated;

-- Issuing an invoice → the categories of its services.
create or replace function public.tag_patient_on_invoice_issued()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c record;
  v_tag uuid;
begin
  if new.status <> 'issued' or old.status = 'issued' or new.kind <> 'invoice' or new.patient_id is null then
    return new;
  end if;
  for c in
    select distinct sc.id, sc.name
    from public.invoice_lines l
    join public.services s on s.id = l.service_id
    join public.service_categories sc on sc.id = s.category_id
    where l.invoice_id = new.id
  loop
    v_tag := public.ensure_auto_tag(new.practice_id, 'category:' || c.id, c.name);
    insert into public.patient_tags (patient_id, tag_id, practice_id, source, created_by)
    values (new.patient_id, v_tag, new.practice_id, 'auto', null)
    on conflict do nothing;
  end loop;
  return new;
end;
$$;
create trigger tag_patient_on_invoice_issued_trigger
  after update of status on public.invoices
  for each row execute function public.tag_patient_on_invoice_issued();

-- Daily: "Nov pacient" and "Brez obiska 12 mesecev".
create or replace function public.refresh_activity_tags()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pr record;
  v_new uuid;
  v_inactive uuid;
begin
  create temporary table if not exists tmp_patient_activity (
    patient_id uuid primary key, practice_id uuid, first_d date, last_d date, booked boolean
  ) on commit drop;
  truncate tmp_patient_activity;

  insert into tmp_patient_activity
  with visit_dates as (
    select v.patient_id, v.date as d
    from public.visits v
    where exists (select 1 from public.tooth_records t where t.visit_id = v.id)
    union all
    select a.patient_id, (a.starts_at at time zone 'Europe/Ljubljana')::date
    from public.appointments a
    where a.status = 'completed'
  )
  select p.id, p.practice_id, min(vd.d), max(vd.d),
    exists (
      select 1 from public.appointments a
      where a.patient_id = p.id and a.starts_at > now() and a.status in ('scheduled', 'sent', 'confirmed')
    )
  from public.patients p
  join visit_dates vd on vd.patient_id = p.id
  group by p.id, p.practice_id;

  for pr in select distinct practice_id from public.patients loop
    v_new := public.ensure_auto_tag(pr.practice_id, 'new_patient', 'Nov pacient');
    v_inactive := public.ensure_auto_tag(pr.practice_id, 'inactive_12m', 'Brez obiska 12 mesecev');

    -- Nov pacient: first visit within 90 days.
    delete from public.patient_tags pt
    where pt.tag_id = v_new
      and not exists (
        select 1 from tmp_patient_activity x
        where x.patient_id = pt.patient_id and x.first_d >= current_date - 90
      );
    insert into public.patient_tags (patient_id, tag_id, practice_id, source, created_by)
    select x.patient_id, v_new, x.practice_id, 'auto', null
    from tmp_patient_activity x
    where x.practice_id = pr.practice_id and x.first_d >= current_date - 90
    on conflict do nothing;

    -- Brez obiska 12 mesecev: last visit over a year ago, nothing booked.
    delete from public.patient_tags pt
    where pt.tag_id = v_inactive
      and not exists (
        select 1 from tmp_patient_activity x
        where x.patient_id = pt.patient_id and x.last_d < current_date - interval '12 months' and not x.booked
      );
    insert into public.patient_tags (patient_id, tag_id, practice_id, source, created_by)
    select x.patient_id, v_inactive, x.practice_id, 'auto', null
    from tmp_patient_activity x
    where x.practice_id = pr.practice_id and x.last_d < current_date - interval '12 months' and not x.booked
    on conflict do nothing;
  end loop;
end;
$$;
revoke execute on function public.refresh_activity_tags() from public, anon, authenticated;

select cron.schedule('refresh-activity-tags', '0 3 * * *', $$select public.refresh_activity_tags()$$);

-- ---- Webhooks: tag_added / tag_removed ------------------------------------------------

alter table public.webhooks drop constraint webhooks_events_check;
alter table public.webhooks add constraint webhooks_events_check
  check (cardinality(events) >= 1 and events <@ array['consent_granted', 'consent_withdrawn', 'tag_added', 'tag_removed']::text[]);

alter table public.webhook_deliveries drop constraint webhook_deliveries_event_check;
alter table public.webhook_deliveries add constraint webhook_deliveries_event_check
  check (event in ('consent_granted', 'consent_withdrawn', 'tag_added', 'tag_removed', 'test'));
alter table public.webhook_deliveries
  -- No foreign key: deleting a tag queues tag_removed for it in the same
  -- statement, and the name is kept here for the payload.
  add column tag_id uuid,
  add column tag_name text;

-- A shareable tag added to / removed from a consented patient → queue.
create or replace function public.enqueue_webhook_tag_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.patient_tags;
  v_event text;
  v_tag public.tags;
begin
  if tg_op = 'INSERT' then r := new; v_event := 'tag_added'; else r := old; v_event := 'tag_removed'; end if;
  select * into v_tag from public.tags where id = r.tag_id;
  if v_tag.id is null or not v_tag.share_externally then
    return null;
  end if;
  if not exists (select 1 from public.patients where id = r.patient_id and marketing_consent) then
    return null;
  end if;
  insert into public.webhook_deliveries (practice_id, webhook_id, event, origin, patient_id, tag_id, tag_name)
  select w.practice_id, w.id, v_event, 'trigger', r.patient_id, v_tag.id, v_tag.name
  from public.webhooks w
  where w.practice_id = r.practice_id and w.enabled and v_event = any(w.events);
  return null;
end;
$$;
create trigger enqueue_webhook_tag_change_trigger
  after insert or delete on public.patient_tags
  for each row execute function public.enqueue_webhook_tag_change();

-- One wake-up per statement (the daily refresh can tag many patients at once).
create or replace function public.kick_webhooks_after_statement()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.webhook_deliveries where status = 'pending' and created_at = now()) then
    perform public.kick_webhook_delivery();
  end if;
  return null;
end;
$$;
create trigger kick_webhooks_after_patient_tags_statement
  after insert or delete on public.patient_tags
  for each statement execute function public.kick_webhooks_after_statement();

-- First run now, so the activity tags exist straight away.
select public.refresh_activity_tags();

commit;
