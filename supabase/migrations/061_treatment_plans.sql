-- Treatment plans / predračun (Gregor, 2026-11-12; roadmap item 4).
--
--   treatment_plans          one predračun for a patient: number PR-YYYY-NNNN
--                            (per practice and year), valid until, note; once
--                            accepted, which variant, how (signed through the
--                            link / QR code, or verbally recorded by staff),
--                            the drawn signature.
--   treatment_plan_variants  alternatives ("Implantat", "Most" …), each with
--   treatment_plan_items     its own items: a price-list service picked by
--                            hand (never matched from the chart automatically),
--                            tooth, quantity, price incl. VAT, discount.
--
-- The patient accepts ONE variant by signing (or staff record a verbal yes);
-- the others are "not chosen". From then on the plan, its variants and items
-- are frozen — the agreed prices. The accepted items go on invoices with one
-- click ("Dodaj iz predračuna"): invoice_lines.treatment_plan_item_id; an item
-- counts as invoiced while it's on a non-cancelled invoice (a storno frees it).
--
-- Acceptance and cancellation only through the functions below. Additive.
begin;

-- ---------------------------------------------------------------- Plans
create table public.treatment_plans (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  number text not null,
  title text not null default 'Predračun' check (length(trim(title)) between 1 and 160),
  note text check (note is null or length(note) <= 4000),
  valid_until date not null default (current_date + 30),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_name text,
  updated_at timestamptz not null default now(),
  -- The signing link's credential (64 hex characters).
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_variant_id uuid,
  accepted_via text check (accepted_via in ('link', 'verbal')),
  -- Staff who recorded a verbal acceptance.
  accepted_by_name text,
  signer_name text,
  signature_png text check (signature_png is null or (signature_png like 'data:image/png;base64,%' and length(signature_png) <= 400000)),
  signer_user_agent text,
  cancelled_at timestamptz,
  unique (practice_id, number)
);
create index treatment_plans_patient_idx on public.treatment_plans(patient_id, created_at desc);

create table public.treatment_plan_variants (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  plan_id uuid not null references public.treatment_plans(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  sort_order integer not null default 0
);
create index treatment_plan_variants_plan_idx on public.treatment_plan_variants(plan_id);
alter table public.treatment_plans
  add constraint treatment_plans_accepted_variant_fk foreign key (accepted_variant_id) references public.treatment_plan_variants(id);

create table public.treatment_plan_items (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  plan_id uuid not null references public.treatment_plans(id) on delete cascade,
  variant_id uuid not null references public.treatment_plan_variants(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  code text,
  name text not null check (length(trim(name)) between 1 and 300),
  unit text not null default 'kos',
  vat_rate numeric(5,2) not null default 0 check (vat_rate >= 0 and vat_rate < 100),
  tooth_fdi text check (tooth_fdi is null or length(tooth_fdi) <= 40),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price_eur numeric(10,2) not null check (unit_price_eur >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  sort_order integer not null default 0
);
create index treatment_plan_items_variant_idx on public.treatment_plan_items(variant_id);
create index treatment_plan_items_plan_idx on public.treatment_plan_items(plan_id);

-- Numbering: PR-2026-0001, per practice and year.
create table public.treatment_plan_sequences (
  practice_id uuid not null references public.practices(id),
  year integer not null,
  last_number integer not null default 0,
  primary key (practice_id, year)
);
alter table public.treatment_plan_sequences enable row level security;
-- No policies: only the trigger below touches it.

-- ---------------------------------------------------------------- Triggers
create or replace function public.prepare_treatment_plan()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from (now() at time zone 'Europe/Ljubljana'))::int;
  v_seq integer;
begin
  select practice_id into new.practice_id from public.patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'Pacienta ni mogoče najti.' using errcode = '42501'; end if;
  insert into public.treatment_plan_sequences (practice_id, year, last_number) values (new.practice_id, v_year, 1)
  on conflict (practice_id, year) do update set last_number = public.treatment_plan_sequences.last_number + 1
  returning last_number into v_seq;
  new.number := 'PR-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  new.created_by := auth.uid();
  new.created_by_name := public.current_user_display_name();
  new.created_at := now();
  new.updated_at := now();
  new.sent_at := null;
  new.accepted_at := null;
  new.accepted_variant_id := null;
  new.accepted_via := null;
  new.accepted_by_name := null;
  new.signer_name := null;
  new.signature_png := null;
  new.signer_user_agent := null;
  new.cancelled_at := null;
  return new;
end;
$$;
create trigger prepare_treatment_plan_trigger
  before insert on public.treatment_plans
  for each row execute function public.prepare_treatment_plan();

-- Acceptance/cancellation fields change only inside the functions below
-- (they set app.treatment_plan_action for their own transaction); an accepted
-- or cancelled plan doesn't change at all otherwise.
create or replace function public.guard_treatment_plan()
returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare
  v_action boolean := coalesce(current_setting('app.treatment_plan_action', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.accepted_at is not null then
      raise exception 'Sprejetega predračuna ni mogoče izbrisati.' using errcode = '42501';
    end if;
    return old;
  end if;
  if v_action then return new; end if;
  if old.accepted_at is not null or old.cancelled_at is not null then
    -- The send function may still note that a link went out.
    if (to_jsonb(new) - 'sent_at') = (to_jsonb(old) - 'sent_at') then return new; end if;
    raise exception 'Predračun je sprejet ali preklican in ga ni mogoče spreminjati.' using errcode = '42501';
  end if;
  if new.accepted_at is distinct from old.accepted_at or new.accepted_variant_id is distinct from old.accepted_variant_id
     or new.accepted_via is distinct from old.accepted_via or new.accepted_by_name is distinct from old.accepted_by_name
     or new.signer_name is distinct from old.signer_name or new.signature_png is distinct from old.signature_png
     or new.signer_user_agent is distinct from old.signer_user_agent or new.cancelled_at is distinct from old.cancelled_at
     or new.number is distinct from old.number or new.token is distinct from old.token
     or new.patient_id is distinct from old.patient_id or new.practice_id is distinct from old.practice_id
     or new.created_by is distinct from old.created_by then
    raise exception 'Tega polja ni mogoče spreminjati.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger guard_treatment_plan_trigger
  before update or delete on public.treatment_plans
  for each row execute function public.guard_treatment_plan();

-- Variants and items: practice from the plan; frozen once the plan is
-- accepted or cancelled.
create or replace function public.prepare_treatment_plan_part()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_plan public.treatment_plans%rowtype;
  v_plan_id uuid := case when tg_op = 'DELETE' then old.plan_id else new.plan_id end;
begin
  select * into v_plan from public.treatment_plans where id = v_plan_id;
  if not found then
    return case when tg_op = 'DELETE' then old else new end;  -- the plan itself is being deleted
  end if;
  if v_plan.accepted_at is not null or v_plan.cancelled_at is not null then
    raise exception 'Predračun je sprejet ali preklican in ga ni mogoče spreminjati.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.plan_id is distinct from old.plan_id then
    raise exception 'Postavke ni mogoče prestaviti v drug predračun.' using errcode = '42501';
  end if;
  new.practice_id := v_plan.practice_id;
  if tg_table_name = 'treatment_plan_items' then
    if not exists (select 1 from public.treatment_plan_variants where id = new.variant_id and plan_id = new.plan_id) then
      raise exception 'Možnost ne pripada temu predračunu.' using errcode = '42501';
    end if;
    if new.service_id is not null and not exists (select 1 from public.services where id = new.service_id and practice_id = v_plan.practice_id) then
      raise exception 'Storitev ne pripada tej ordinaciji.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger prepare_treatment_plan_variant_trigger
  before insert or update or delete on public.treatment_plan_variants
  for each row execute function public.prepare_treatment_plan_part();
create trigger prepare_treatment_plan_item_trigger
  before insert or update or delete on public.treatment_plan_items
  for each row execute function public.prepare_treatment_plan_part();

-- ---------------------------------------------------------------- RLS
alter table public.treatment_plans enable row level security;
create policy treatment_plans_select on public.treatment_plans for select using (practice_id = public.current_practice_id());
create policy treatment_plans_insert on public.treatment_plans for insert with check (practice_id = public.current_practice_id());
create policy treatment_plans_update on public.treatment_plans for update
  using (practice_id = public.current_practice_id()) with check (practice_id = public.current_practice_id());
create policy treatment_plans_delete on public.treatment_plans for delete using (practice_id = public.current_practice_id());

alter table public.treatment_plan_variants enable row level security;
create policy treatment_plan_variants_select on public.treatment_plan_variants for select using (practice_id = public.current_practice_id());
create policy treatment_plan_variants_insert on public.treatment_plan_variants for insert with check (practice_id = public.current_practice_id());
create policy treatment_plan_variants_update on public.treatment_plan_variants for update
  using (practice_id = public.current_practice_id()) with check (practice_id = public.current_practice_id());
create policy treatment_plan_variants_delete on public.treatment_plan_variants for delete using (practice_id = public.current_practice_id());

alter table public.treatment_plan_items enable row level security;
create policy treatment_plan_items_select on public.treatment_plan_items for select using (practice_id = public.current_practice_id());
create policy treatment_plan_items_insert on public.treatment_plan_items for insert with check (practice_id = public.current_practice_id());
create policy treatment_plan_items_update on public.treatment_plan_items for update
  using (practice_id = public.current_practice_id()) with check (practice_id = public.current_practice_id());
create policy treatment_plan_items_delete on public.treatment_plan_items for delete using (practice_id = public.current_practice_id());

-- ---------------------------------------------------------------- Actions
-- Staff record a verbal acceptance of one variant.
create or replace function public.accept_treatment_plan_verbally(p_plan_id uuid, p_variant_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v public.treatment_plans%rowtype;
begin
  select * into v from public.treatment_plans where id = p_plan_id for update;
  if not found or v.practice_id is distinct from public.current_practice_id() then
    raise exception 'Predračuna ni mogoče najti.' using errcode = '42501';
  end if;
  if v.accepted_at is not null then raise exception 'Predračun je že sprejet.' using errcode = '22023'; end if;
  if v.cancelled_at is not null then raise exception 'Predračun je preklican.' using errcode = '22023'; end if;
  if not exists (select 1 from public.treatment_plan_variants where id = p_variant_id and plan_id = p_plan_id) then
    raise exception 'Možnost ne pripada temu predračunu.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.treatment_plan_items where variant_id = p_variant_id) then
    raise exception 'Izbrana možnost nima postavk.' using errcode = '22023';
  end if;
  perform set_config('app.treatment_plan_action', 'on', true);
  update public.treatment_plans
     set accepted_at = now(), accepted_variant_id = p_variant_id, accepted_via = 'verbal',
         accepted_by_name = public.current_user_display_name()
   where id = p_plan_id;
  perform set_config('app.treatment_plan_action', 'off', true);
end;
$$;
revoke all on function public.accept_treatment_plan_verbally(uuid, uuid) from public;
grant execute on function public.accept_treatment_plan_verbally(uuid, uuid) to authenticated;

-- The patient signs through the link / QR code (treatment-plan function,
-- service role only).
create or replace function public.sign_treatment_plan(p_token text, p_variant_id uuid, p_signer_name text, p_signature_png text, p_user_agent text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v public.treatment_plans%rowtype;
begin
  select * into v from public.treatment_plans where token = p_token for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if v.accepted_at is not null then raise exception 'already_accepted' using errcode = '22023'; end if;
  if v.cancelled_at is not null then raise exception 'cancelled' using errcode = '22023'; end if;
  if v.valid_until < (now() at time zone 'Europe/Ljubljana')::date then raise exception 'expired' using errcode = '22023'; end if;
  if not exists (select 1 from public.treatment_plan_variants where id = p_variant_id and plan_id = v.id)
     or not exists (select 1 from public.treatment_plan_items where variant_id = p_variant_id) then
    raise exception 'invalid_variant' using errcode = '22023';
  end if;
  perform set_config('app.treatment_plan_action', 'on', true);
  update public.treatment_plans
     set accepted_at = now(), accepted_variant_id = p_variant_id, accepted_via = 'link',
         signer_name = left(trim(p_signer_name), 120), signature_png = p_signature_png, signer_user_agent = left(p_user_agent, 400)
   where id = v.id;
  perform set_config('app.treatment_plan_action', 'off', true);
  return v.id;
end;
$$;
revoke all on function public.sign_treatment_plan(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.sign_treatment_plan(text, uuid, text, text, text) to service_role;

create or replace function public.cancel_treatment_plan(p_plan_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v public.treatment_plans%rowtype;
begin
  select * into v from public.treatment_plans where id = p_plan_id;
  if not found or v.practice_id is distinct from public.current_practice_id() then
    raise exception 'Predračuna ni mogoče najti.' using errcode = '42501';
  end if;
  if v.cancelled_at is not null then return; end if;
  if exists (
    select 1 from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
     join public.treatment_plan_items t on t.id = l.treatment_plan_item_id
     where t.plan_id = p_plan_id and i.kind = 'invoice' and i.cancelled_at is null
  ) then
    raise exception 'Predračun ima zaračunane postavke — najprej stornirajte račun.' using errcode = '22023';
  end if;
  perform set_config('app.treatment_plan_action', 'on', true);
  update public.treatment_plans set cancelled_at = now() where id = p_plan_id;
  perform set_config('app.treatment_plan_action', 'off', true);
end;
$$;
revoke all on function public.cancel_treatment_plan(uuid) from public;
grant execute on function public.cancel_treatment_plan(uuid) to authenticated;

-- The QR code: the plan's token (refused once accepted, cancelled or expired).
create or replace function public.prepare_treatment_plan_link(p_plan_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v public.treatment_plans%rowtype;
begin
  select * into v from public.treatment_plans where id = p_plan_id;
  if not found or v.practice_id is distinct from public.current_practice_id() then
    raise exception 'Predračuna ni mogoče najti.' using errcode = '42501';
  end if;
  if v.accepted_at is not null then raise exception 'Predračun je že sprejet.' using errcode = '22023'; end if;
  if v.cancelled_at is not null then raise exception 'Predračun je preklican.' using errcode = '22023'; end if;
  if v.valid_until < (now() at time zone 'Europe/Ljubljana')::date then
    raise exception 'Predračun je potekel — podaljšajte veljavnost.' using errcode = '22023';
  end if;
  return v.token;
end;
$$;
revoke all on function public.prepare_treatment_plan_link(uuid) from public;
grant execute on function public.prepare_treatment_plan_link(uuid) to authenticated;

-- ---------------------------------------------------------------- Invoices
alter table public.invoice_lines add column treatment_plan_item_id uuid references public.treatment_plan_items(id) on delete set null;
create index invoice_lines_treatment_plan_item_idx on public.invoice_lines(treatment_plan_item_id) where treatment_plan_item_id is not null;

-- A line may bill an item of an ACCEPTED plan's chosen variant, same practice.
create or replace function public.check_invoice_line_plan_item()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.treatment_plan_item_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.treatment_plan_item_id is not distinct from old.treatment_plan_item_id then return new; end if;
  if not exists (
    select 1 from public.treatment_plan_items t join public.treatment_plans p on p.id = t.plan_id
     where t.id = new.treatment_plan_item_id and p.practice_id = new.practice_id
       and p.accepted_variant_id = t.variant_id and p.cancelled_at is null
  ) then
    raise exception 'Postavka ni iz sprejetega predračuna te ordinacije.' using errcode = '42501';
  end if;
  return new;
end;
$$;
-- After prepare_invoice_line_trigger (alphabetical), so practice_id is set.
create trigger z_check_invoice_line_plan_item_trigger
  before insert or update on public.invoice_lines
  for each row execute function public.check_invoice_line_plan_item();

-- ---------------------------------------------------------------- Email
alter table public.email_log drop constraint if exists email_log_email_type_check;
alter table public.email_log add constraint email_log_email_type_check check (email_type in (
  'appointment_confirmation', 'appointment_reminder', 'appointment_cancelled', 'appointment_rescheduled',
  'post_visit', 'recall', 'health_questionnaire', 'invoice', 'aftercare', 'marketing_consent', 'patient_consent',
  'treatment_plan'
));
alter table public.email_templates drop constraint if exists email_templates_template_key_check;
alter table public.email_templates add constraint email_templates_template_key_check check (template_key in (
  'appointment_confirmation', 'appointment_reminder', 'appointment_cancelled', 'appointment_rescheduled',
  'post_visit', 'recall', 'health_questionnaire', 'invoice', 'credit_note', 'aftercare', 'patient_consent',
  'treatment_plan'
));

-- ---------------------------------------------------------------- Audit log
-- Plans are patient data; acceptance is logged as a signature.
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
    -- Signing (a visit, a patient's consent — 058, a predračun accepted — 061)
    -- is its own action.
    if (tg_table_name in ('visits', 'patient_consents') and (v_old ->> 'signed_at') is null and (v_row ->> 'signed_at') is not null)
       or (tg_table_name = 'treatment_plans' and (v_old ->> 'accepted_at') is null and (v_row ->> 'accepted_at') is not null) then
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
create trigger audit_treatment_plans after insert or update or delete on public.treatment_plans
  for each row execute function public.audit_row_change();

commit;
