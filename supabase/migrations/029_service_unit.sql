-- Enota mere (EM) per price-list service, e.g. "kos", "zob", "čeljust",
-- "ura" — until now every invoice line printed "kos". The unit is copied onto
-- the invoice line when it's added (a snapshot, like code/name/VAT rate), so
-- renaming it in the price list later never changes an issued invoice.
begin;

alter table public.services
  add column unit text not null default 'kos' check (length(trim(unit)) between 1 and 12);

alter table public.invoice_lines
  add column unit text not null default 'kos' check (length(trim(unit)) between 1 and 12);

-- Same as 025's version, plus the unit copied onto the credit note's lines.
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

  insert into public.invoice_lines (invoice_id, position, service_id, code, name, unit, vat_rate, tooth_fdi, quantity, unit_price_eur, discount_percent)
  select v_new, position, service_id, code, name, unit, vat_rate, tooth_fdi, -quantity, unit_price_eur, discount_percent
  from public.invoice_lines where invoice_id = orig.id;

  perform public.issue_invoice_internal(v_new);

  perform set_config('app.invoice_issuing', 'on', true);
  update public.invoices set cancelled_at = now() where id = orig.id;
  perform set_config('app.invoice_issuing', 'off', true);
  return v_new;
end;
$$;

revoke execute on function public.cancel_invoice(uuid) from public, anon;
grant execute on function public.cancel_invoice(uuid) to authenticated;

commit;
