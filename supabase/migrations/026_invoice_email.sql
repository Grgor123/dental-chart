-- Sending an issued invoice by email (the "Pošlji po e-pošti" window in the
-- invoice editor → the send-invoice-email Edge Function, PDF attached).
--   - email_log gets an invoice_id and a new 'invoice' email_type, so every
--     sent invoice is recorded per recipient and shown on the invoice;
--   - practice_id stamping falls back to the invoice, since an invoice may
--     have no patient (migration 025).
begin;

alter table public.email_log
  add column invoice_id uuid references public.invoices(id) on delete set null;
create index email_log_invoice_id_idx on public.email_log(invoice_id);

alter table public.email_log drop constraint if exists email_log_email_type_check;
alter table public.email_log add constraint email_log_email_type_check check (email_type in (
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'post_visit',
  'recall',
  'health_questionnaire',
  'invoice'
));

create or replace function public.set_email_log_practice_id()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.appointment_id is not null then
    select practice_id into new.practice_id from public.appointments where id = new.appointment_id;
  elsif new.patient_id is not null then
    select practice_id into new.practice_id from public.patients where id = new.patient_id;
  elsif new.invoice_id is not null then
    select practice_id into new.practice_id from public.invoices where id = new.invoice_id;
  end if;
  if new.practice_id is null then
    raise exception 'cannot resolve practice_id for email_log row (need appointment_id, patient_id or invoice_id)';
  end if;
  return new;
end;
$$;
drop trigger if exists set_email_log_practice_id_trigger on public.email_log;
create trigger set_email_log_practice_id_trigger
  before insert or update of appointment_id, patient_id, invoice_id on public.email_log
  for each row execute function public.set_email_log_practice_id();

commit;
