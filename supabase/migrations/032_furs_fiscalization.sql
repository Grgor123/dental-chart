-- Invoicing phase 2: FURS davčno potrjevanje (fiscal verification).
-- Cash and card invoices (and their credit notes) are sent to FURS right
-- after issuing; FURS answers with an EOR. See CLAUDE.md "FURS".
--   - user_profiles: each login's own name + tax number (FURS wants the
--     personal tax number of whoever issues the invoice — OperatorTaxNumber).
--   - furs_premises: the business premise (P1) data and its registration with
--     FURS. Written only by the furs-register-premise Edge Function (service
--     role), so a browser can't mark a premise "registered".
--   - invoices.furs_*: the ZOI, EOR, status and the FURS QR value, written only
--     through record_invoice_furs() (service role), since issued invoices are
--     otherwise immutable (guard_invoice).
--   - a cron job re-sends invoices still waiting for FURS every 10 minutes.
begin;

-- ---- User profile ----------------------------------------------------------
create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  practice_id uuid not null references public.practices(id),
  full_name text,
  tax_number text check (tax_number is null or tax_number ~ '^\d{8}$'),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
-- Only your own profile — colleagues don't see each other's tax numbers.
create policy user_profiles_select on public.user_profiles for select
  using (user_id = auth.uid() and practice_id = public.current_practice_id());
create policy user_profiles_insert on public.user_profiles for insert
  with check (user_id = auth.uid() and practice_id = public.current_practice_id());
create policy user_profiles_update on public.user_profiles for update
  using (user_id = auth.uid() and practice_id = public.current_practice_id())
  with check (user_id = auth.uid() and practice_id = public.current_practice_id());

-- ---- Business premise ------------------------------------------------------
create table public.furs_premises (
  practice_id uuid not null references public.practices(id),
  premise_code text not null,
  cadastral_number integer not null,
  building_number integer not null,
  building_section_number integer not null,
  street text not null,
  house_number text not null,
  house_number_additional text,
  community text not null,
  city text not null,
  postal_code text not null,
  validity_date date not null,
  -- Which FURS environment it is registered with ('test' / 'production'):
  -- switching environments needs a fresh registration.
  environment text not null check (environment in ('test', 'production')),
  registered_at timestamptz not null,
  registered_by uuid references auth.users(id),
  primary key (practice_id, premise_code)
);
alter table public.furs_premises enable row level security;
-- Read-only for the practice; only furs-register-premise (service role) writes.
create policy furs_premises_select on public.furs_premises for select
  using (practice_id = public.current_practice_id());

-- ---- Invoice FURS fields ---------------------------------------------------
alter table public.invoices
  -- null = not sent to FURS (bank transfer, or FURS not set up)
  add column furs_status text check (furs_status in ('pending', 'confirmed', 'failed')),
  add column furs_zoi text,
  add column furs_eor text,
  -- The 60-digit value of the FURS QR code printed on the invoice.
  add column furs_qr text,
  add column furs_operator_tax_number text,
  add column furs_error text,
  add column furs_attempts integer not null default 0,
  add column furs_last_attempt_at timestamptz,
  add column furs_confirmed_at timestamptz;
create index invoices_furs_pending_idx on public.invoices(furs_status) where furs_status = 'pending';

-- The one way to write FURS results onto an issued invoice (guard_invoice
-- otherwise rejects any change). Service role only — the Edge Function.
create or replace function public.record_invoice_furs(
  p_invoice_id uuid,
  p_status text,
  p_zoi text,
  p_eor text,
  p_qr text,
  p_operator_tax_number text,
  p_error text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('app.invoice_issuing', 'on', true);
  update public.invoices set
    furs_status = p_status,
    furs_zoi = coalesce(furs_zoi, p_zoi),  -- the ZOI never changes once set
    furs_eor = coalesce(p_eor, furs_eor),
    furs_qr = coalesce(furs_qr, p_qr),
    furs_operator_tax_number = coalesce(furs_operator_tax_number, p_operator_tax_number),
    furs_error = p_error,
    furs_attempts = furs_attempts + case when p_status = 'confirmed' or p_error is not null then 1 else 0 end,
    furs_last_attempt_at = case when p_status = 'confirmed' or p_error is not null then now() else furs_last_attempt_at end,
    furs_confirmed_at = case when p_status = 'confirmed' then now() else furs_confirmed_at end
  where id = p_invoice_id and status = 'issued';
  perform set_config('app.invoice_issuing', 'off', true);
end;
$$;
revoke execute on function public.record_invoice_furs(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_invoice_furs(uuid, text, text, text, text, text, text) to service_role;

-- ---- Retry: re-send invoices waiting for FURS ------------------------------
select cron.schedule(
  'fiscalize-pending-invoices',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/fiscalize-invoice',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key')
    ),
    body := '{"retryPending": true}'::jsonb
  );
  $$
);

commit;
