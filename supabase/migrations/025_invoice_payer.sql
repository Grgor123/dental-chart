-- Invoices without a patient, and an editable payer.
--   - Issued from the Računi page, an invoice can go to someone who isn't a
--     patient (a payer typed in by hand), so patient_id becomes optional. With
--     no patient there's no row to inherit practice_id from, so the client sets
--     it (like a root table) and the insert/update RLS check keeps it to the
--     user's own practice.
--   - The draft's payer (name, address, tax number) is editable — e.g. a
--     company paying for a patient — and stored in `buyer`, which
--     issue_invoice_internal() already snapshots as-is when present. It now
--     refuses to issue with no payer at all.
--   - cancel_invoice() passes practice_id through for the credit note, since a
--     patient-less invoice has nothing to derive it from.
begin;

alter table public.invoices alter column patient_id drop not null;

create or replace function public.set_invoice_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.patient_id is not null then
    select practice_id into new.practice_id from public.patients where id = new.patient_id;
    if new.practice_id is null then raise exception 'cannot resolve practice_id for patient %', new.patient_id; end if;
  elsif new.practice_id is null then
    raise exception 'practice_id is required for an invoice without a patient';
  end if;
  if new.appointment_id is not null and not exists (
    select 1 from public.appointments a where a.id = new.appointment_id and a.practice_id = new.practice_id
  ) then
    raise exception 'appointment does not belong to this practice';
  end if;
  return new;
end;
$$;

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
  -- A payer must be known: entered on the draft, or the linked patient.
  if coalesce(trim(inv.buyer ->> 'name'), '') = '' and p.id is null then
    raise exception 'invoice_no_buyer';
  end if;

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
    -- The logo is left out of the snapshot (it's an image, and copying it into
    -- every invoice row would bloat the table); prints use the current logo.
    issuer = to_jsonb(s) - 'practice_id' - 'updated_at' - 'logo_data_url',
    buyer = coalesce(inv.buyer, jsonb_build_object(
      'name', trim(p.first_name || ' ' || p.last_name),
      'address', p.address,
      'postal_code', p.postal_code,
      'city', p.city,
      'tax_number', nullif(trim(inv.buyer_tax_number), ''))),
    total_eur = v_total,
    vat_breakdown = v_breakdown
  where id = inv.id;

  perform set_config('app.invoice_issuing', 'off', true);
end;
$$;

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

  insert into public.invoices (practice_id, patient_id, appointment_id, kind, original_invoice_id, service_date, payment_method, buyer, note)
  values (orig.practice_id, orig.patient_id, orig.appointment_id, 'credit_note', orig.id, orig.service_date, orig.payment_method, orig.buyer,
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
revoke execute on function public.cancel_invoice(uuid) from public, anon;
grant execute on function public.cancel_invoice(uuid) to authenticated;

commit;
