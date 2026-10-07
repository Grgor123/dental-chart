-- Invoice appearance (Nastavitve → Podatki za račune):
--   - an optional logo, stored as a small data URL (resized in the browser
--     before upload) so printing and a later Edge Function need no file
--     storage or extra fetch;
--   - phone / email / website, each with its own "show on invoice" tick;
--   - the payer's optional tax number, entered per invoice on the draft
--     (a company or another person may pay), snapshotted into `buyer`.
-- issue_invoice_internal() is re-created for the two snapshot changes; the
-- rest of it is unchanged from 023.
begin;

alter table public.invoice_settings
  add column logo_data_url text check (logo_data_url is null or length(logo_data_url) <= 700000),
  add column phone text,
  add column email text,
  add column website text,
  add column show_phone boolean not null default true,
  add column show_email boolean not null default true,
  add column show_website boolean not null default true;

alter table public.invoices
  add column buyer_tax_number text;

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

revoke execute on function public.issue_invoice_internal(uuid) from public, anon, authenticated;

commit;
