-- Invoicing, phase 1: invoices + lines, issuer settings, gapless numbering,
-- immutability of issued invoices, storno via credit note. Printing (A4 +
-- thermal roll) is client-side — see supabase/functions/_shared/invoice/.
--
-- Built so phase 2 (FURS fiscal verification) only ADDS to this:
--   - numbers already have FURS's shape, premise-device-sequence ("P1-B1-14"),
--     assigned centrally per premise (FURS numbering structure "C"), so
--     several computers can never collide; restarts at 1 every calendar year;
--   - an issued invoice can never change (only paid_at/cancelled_at), and a
--     correction is a credit note with its own number referencing the original;
--   - phase 2 adds zoi/eor/fiscal_status columns + a fiscalize Edge Function.
--
-- NOTE: until phase 2, invoices paid in cash or by card are NOT fiscally
-- verified, so they must not be used for real cash/card payments yet.
begin;

-- ---- Issuer settings (Nastavitve → Podatki za račune) -------------------------
-- A separate table rather than columns on `practices`: practices only has a
-- select policy, and opening an update policy there would also expose the
-- email-domain columns. Root table, so the client sets practice_id.
create table public.invoice_settings (
  practice_id uuid primary key references public.practices(id),
  legal_name text,                 -- full legal name of the issuer
  address text,
  postal_code text,
  city text,                       -- also the "kraj izdaje" on the invoice
  tax_number text,                 -- davčna številka (8 digits; "SI" prefix printed for VAT payers)
  registration_number text,        -- matična številka
  vat_payer boolean not null default true,
  iban text,
  bank_name text,
  premise_code text not null default 'P1',  -- FURS business premise label (registered in phase 2)
  device_code text not null default 'B1',   -- FURS electronic device label
  vat_exempt_note text not null default 'Oproščeno plačila DDV po 2. točki 1. odstavka 42. člena ZDDV-1.',
  payment_due_days integer not null default 8 check (payment_due_days between 0 and 365),
  footer_note text,
  receipt_width_mm integer not null default 80 check (receipt_width_mm in (58, 80)),
  updated_at timestamptz not null default now()
);

alter table public.invoice_settings enable row level security;
create policy invoice_settings_select on public.invoice_settings for select
  using (practice_id = public.current_practice_id());
create policy invoice_settings_insert on public.invoice_settings for insert
  with check (practice_id = public.current_practice_id());
create policy invoice_settings_update on public.invoice_settings for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy invoice_settings_delete on public.invoice_settings for delete
  using (practice_id = public.current_practice_id());

-- ---- Sequences ------------------------------------------------------------------
-- RLS on with NO policies: only the security-definer issuing function below
-- ever reads or writes this, so a client can't skip or reuse a number.
create table public.invoice_sequences (
  practice_id uuid not null references public.practices(id),
  premise_code text not null,
  year integer not null,
  last_number integer not null,
  primary key (practice_id, premise_code, year)
);
alter table public.invoice_sequences enable row level security;

-- ---- Invoices ---------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),  -- auto-stamped from the patient row
  patient_id uuid not null references public.patients(id),    -- no cascade: issued invoices must outlive edits
  appointment_id uuid references public.appointments(id) on delete set null,
  kind text not null default 'invoice' check (kind in ('invoice','credit_note')),
  original_invoice_id uuid references public.invoices(id),    -- set on a credit note (storno)
  status text not null default 'draft' check (status in ('draft','issued')),
  -- Numbering — null while a draft, set once by issue_invoice().
  premise_code text,
  device_code text,
  year integer,
  sequence_number integer,
  number text,
  issued_at timestamptz,
  issued_by uuid references auth.users(id),
  issued_by_email text,
  service_date date not null default current_date,  -- datum opravljene storitve
  due_date date,
  payment_method text not null default 'cash' check (payment_method in ('cash','card','transfer')),
  paid_at timestamptz,
  cancelled_at timestamptz,        -- set on the ORIGINAL when it's cancelled by a credit note
  -- Snapshots taken at issue time, so a reprint years later is identical even
  -- if the patient's address or the practice's details change.
  issuer jsonb,
  buyer jsonb,
  total_eur numeric(12,2),
  vat_breakdown jsonb,             -- [{rate, gross, net, vat}], computed at issue
  note text,
  created_at timestamptz not null default now()
);
create unique index invoices_number_idx
  on public.invoices(practice_id, premise_code, year, sequence_number) where sequence_number is not null;
create index invoices_practice_id_idx on public.invoices(practice_id);
create index invoices_patient_id_idx on public.invoices(patient_id);
create index invoices_issued_at_idx on public.invoices(issued_at);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),  -- auto-stamped from the invoice row
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  position integer not null default 0,
  service_id uuid references public.services(id),
  -- Snapshots of the price-list row when the line was added.
  code text,
  name text not null,
  vat_rate numeric(4,1) not null default 0 check (vat_rate between 0 and 100),
  tooth_fdi text,
  quantity numeric(10,2) not null default 1 check (quantity <> 0),
  -- Final price per unit, VAT INCLUDED (price-list prices are final prices).
  unit_price_eur numeric(10,2) not null check (unit_price_eur >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  line_total_eur numeric(12,2) not null default 0,  -- always recomputed by the trigger below
  created_at timestamptz not null default now()
);
create index invoice_lines_invoice_id_idx on public.invoice_lines(invoice_id);
create index invoice_lines_practice_id_idx on public.invoice_lines(practice_id);

-- ---- Triggers: practice stamping + integrity ----------------------------------------

-- Every guard below can be bypassed only from inside issue/cancel (a
-- transaction-local flag that only those security-definer functions set —
-- set_config isn't reachable through the API).
create or replace function public.invoice_issuing_in_progress()
returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce(current_setting('app.invoice_issuing', true), '') = 'on';
$$;

create or replace function public.set_invoice_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from public.patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  if new.appointment_id is not null and not exists (
    select 1 from public.appointments a where a.id = new.appointment_id and a.practice_id = new.practice_id
  ) then
    raise exception 'appointment does not belong to this practice';
  end if;
  return new;
end;
$$;
create trigger set_invoice_practice_id_trigger
  before insert or update of patient_id, appointment_id on public.invoices
  for each row execute function public.set_invoice_practice_id();

-- Drafts are free; issued invoices are permanent. A client may only ever
-- create a plain draft, and may never issue one by hand (status/number are
-- set exclusively by issue_invoice()).
create or replace function public.guard_invoice()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'issued' then raise exception 'invoice_issued_immutable'; end if;
    return old;
  end if;

  if public.invoice_issuing_in_progress() then return new; end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.kind <> 'invoice' or new.original_invoice_id is not null
       or new.number is not null or new.sequence_number is not null or new.issued_at is not null
       or new.paid_at is not null or new.cancelled_at is not null then
      raise exception 'invoice_must_start_as_draft';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status = 'issued' then
    if (to_jsonb(new) - 'paid_at' - 'cancelled_at') is distinct from (to_jsonb(old) - 'paid_at' - 'cancelled_at') then
      raise exception 'invoice_issued_immutable';
    end if;
    if old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at then
      raise exception 'invoice_issued_immutable';
    end if;
    if old.cancelled_at is null and new.cancelled_at is not null then
      raise exception 'use_cancel_invoice';
    end if;
    return new;
  end if;

  -- A draft stays a draft with no number until issue_invoice() runs.
  if new.status <> 'draft' or new.kind is distinct from old.kind
     or new.original_invoice_id is distinct from old.original_invoice_id
     or new.number is not null or new.sequence_number is not null or new.issued_at is not null
     or new.paid_at is not null or new.cancelled_at is not null then
    raise exception 'use_issue_invoice';
  end if;
  return new;
end;
$$;
create trigger guard_invoice_trigger
  before insert or update or delete on public.invoices
  for each row execute function public.guard_invoice();

-- Lines: stamp practice_id from the invoice, block any change once the
-- invoice is issued, and recompute the line total server-side so the client
-- never decides an amount.
create or replace function public.prepare_invoice_line()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text;
  v_practice uuid;
begin
  if tg_op = 'DELETE' then
    select status into v_status from public.invoices where id = old.invoice_id;
    -- v_status is null while the parent itself is being deleted (cascade).
    if v_status = 'issued' then raise exception 'invoice_issued_immutable'; end if;
    return old;
  end if;

  select status, practice_id into v_status, v_practice from public.invoices where id = new.invoice_id;
  if v_practice is null then raise exception 'invoice not found'; end if;
  if v_status = 'issued' then raise exception 'invoice_issued_immutable'; end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then raise exception 'cannot move a line'; end if;
  if new.service_id is not null and not exists (
    select 1 from public.services s where s.id = new.service_id and s.practice_id = v_practice
  ) then
    raise exception 'service does not belong to this practice';
  end if;

  new.practice_id := v_practice;
  new.line_total_eur := round(new.quantity * new.unit_price_eur * (1 - new.discount_percent / 100), 2);
  return new;
end;
$$;
create trigger prepare_invoice_line_trigger
  before insert or update or delete on public.invoice_lines
  for each row execute function public.prepare_invoice_line();

-- ---- RLS ----------------------------------------------------------------------------
alter table public.invoices enable row level security;
create policy invoices_select on public.invoices for select
  using (practice_id = public.current_practice_id());
create policy invoices_insert on public.invoices for insert
  with check (practice_id = public.current_practice_id());
create policy invoices_update on public.invoices for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy invoices_delete on public.invoices for delete
  using (practice_id = public.current_practice_id());

alter table public.invoice_lines enable row level security;
create policy invoice_lines_select on public.invoice_lines for select
  using (practice_id = public.current_practice_id());
create policy invoice_lines_insert on public.invoice_lines for insert
  with check (practice_id = public.current_practice_id());
create policy invoice_lines_update on public.invoice_lines for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy invoice_lines_delete on public.invoice_lines for delete
  using (practice_id = public.current_practice_id());

-- ---- Issuing -----------------------------------------------------------------------

-- Internal: does the actual issuing, no caller check. Not callable through the
-- API (execute revoked below) — only from issue_invoice()/cancel_invoice().
create or replace function public.issue_invoice_internal(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv public.invoices;
  s public.invoice_settings;
  p public.patients;
  v_now timestamptz := now();
  v_year integer;
  v_number integer;
  v_total numeric(12,2);
  v_breakdown jsonb;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null then raise exception 'invoice_not_found'; end if;
  if inv.status <> 'draft' then raise exception 'invoice_not_draft'; end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = inv.id) then
    raise exception 'invoice_no_lines';
  end if;

  select * into s from public.invoice_settings where practice_id = inv.practice_id;
  if s.practice_id is null or coalesce(trim(s.legal_name), '') = '' or coalesce(trim(s.tax_number), '') = '' then
    raise exception 'invoice_settings_incomplete';
  end if;
  select * into p from public.patients where id = inv.patient_id;

  perform set_config('app.invoice_issuing', 'on', true);

  -- Gapless: the upsert takes a row lock, so two invoices issued at the same
  -- moment on two computers queue up rather than share a number.
  v_year := extract(year from (v_now at time zone 'Europe/Ljubljana'))::integer;
  insert into public.invoice_sequences (practice_id, premise_code, year, last_number)
  values (inv.practice_id, s.premise_code, v_year, 1)
  on conflict (practice_id, premise_code, year)
    do update set last_number = public.invoice_sequences.last_number + 1
  returning last_number into v_number;

  -- Totals from the lines (line_total_eur is already server-computed).
  -- Prices include VAT: vat = gross * rate / (100 + rate).
  select coalesce(sum(line_total_eur), 0) into v_total from public.invoice_lines where invoice_id = inv.id;
  select coalesce(jsonb_agg(jsonb_build_object('rate', rate, 'gross', gross, 'vat', vat, 'net', gross - vat) order by rate), '[]'::jsonb)
    into v_breakdown
  from (
    select vat_rate as rate, sum(line_total_eur) as gross,
           round(sum(line_total_eur) * vat_rate / (100 + vat_rate), 2) as vat
    from public.invoice_lines where invoice_id = inv.id group by vat_rate
  ) g;

  update public.invoices set
    status = 'issued',
    premise_code = s.premise_code,
    device_code = s.device_code,
    year = v_year,
    sequence_number = v_number,
    number = s.premise_code || '-' || s.device_code || '-' || v_number,
    issued_at = v_now,
    issued_by = auth.uid(),
    issued_by_email = auth.jwt() ->> 'email',
    due_date = case when inv.payment_method = 'transfer'
                    then (v_now at time zone 'Europe/Ljubljana')::date + s.payment_due_days end,
    -- Cash/card are settled on the spot; so is a credit note.
    paid_at = case when inv.payment_method in ('cash','card') or inv.kind = 'credit_note' then v_now end,
    issuer = to_jsonb(s) - 'practice_id' - 'updated_at',
    buyer = coalesce(inv.buyer, jsonb_build_object(
      'name', trim(p.first_name || ' ' || p.last_name),
      'address', p.address,
      'postal_code', p.postal_code,
      'city', p.city)),
    total_eur = v_total,
    vat_breakdown = v_breakdown
  where id = inv.id;

  perform set_config('app.invoice_issuing', 'off', true);
end;
$$;

create or replace function public.issue_invoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.invoices where id = p_invoice_id and practice_id = public.current_practice_id()
  ) then
    raise exception 'invoice_not_found';
  end if;
  perform public.issue_invoice_internal(p_invoice_id);
end;
$$;

-- Storno: a credit note with every line negated, issued at once with its own
-- number, referencing the original; the original is marked cancelled.
-- Returns the credit note's id.
create or replace function public.cancel_invoice(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  orig public.invoices;
  v_new uuid;
begin
  select * into orig from public.invoices
  where id = p_invoice_id and practice_id = public.current_practice_id()
  for update;
  if orig.id is null then raise exception 'invoice_not_found'; end if;
  if orig.status <> 'issued' or orig.kind <> 'invoice' then raise exception 'invoice_not_cancellable'; end if;
  if orig.cancelled_at is not null then raise exception 'invoice_already_cancelled'; end if;

  perform set_config('app.invoice_issuing', 'on', true);

  insert into public.invoices (patient_id, appointment_id, kind, original_invoice_id, service_date, payment_method, buyer, note)
  values (orig.patient_id, orig.appointment_id, 'credit_note', orig.id, orig.service_date, orig.payment_method, orig.buyer,
          'Storno računa ' || orig.number)
  returning id into v_new;

  insert into public.invoice_lines (invoice_id, position, service_id, code, name, vat_rate, tooth_fdi, quantity, unit_price_eur, discount_percent)
  select v_new, position, service_id, code, name, vat_rate, tooth_fdi, -quantity, unit_price_eur, discount_percent
  from public.invoice_lines where invoice_id = orig.id;

  perform public.issue_invoice_internal(v_new);

  perform set_config('app.invoice_issuing', 'on', true);
  update public.invoices set cancelled_at = now() where id = orig.id;
  perform set_config('app.invoice_issuing', 'off', true);
  return v_new;
end;
$$;

revoke execute on function public.issue_invoice_internal(uuid) from public, anon, authenticated;
revoke execute on function public.issue_invoice(uuid) from public, anon;
revoke execute on function public.cancel_invoice(uuid) from public, anon;
grant execute on function public.issue_invoice(uuid) to authenticated;
grant execute on function public.cancel_invoice(uuid) to authenticated;

commit;
