-- ZZZS šifrant, chart → service links and performed services — the
-- foundation for "Dodaj iz karte" on the invoice. Built for private practices
-- first; the payer column and zzzs_contract are reserved for a later
-- concession (ZZZS billing) module and are not used yet.
--   - zzzs_editions / zzzs_services: the official ZZZS dental code lists,
--     shared by every practice, read-only to the app. Written only by the
--     zzzs-sync loader (service role). A code is never deleted: when a newer
--     edition drops or changes it, the old row gets valid_to, so an old record
--     still shows the code that was valid at the time.
--   - services.zzzs_code: the ZZZS code a practice service corresponds to
--     (null for the practice's own services, e.g. implants).
--   - invoice_settings.use_zzzs_sifrant: Nastavitve → Cenik "Uporabljaj
--     šifrant ZZZS" (off by default). zzzs_contract: reserved.
--   - service_chart_links: which chart mark ("filling, 2 surfaces",
--     "extraction", …) leads to which service. Several links for one mark make
--     up its short pick-list on the invoice.
--   - performed_services: one row per service done in a visit (tooth, mark,
--     service, payer) — what an invoice line is billed from.
--   - invoice_lines.performed_service_id: which performed service a line
--     bills; cancel_invoice() copies it onto the credit note.
begin;

-- ---- ZZZS catalogue ----------------------------------------------------------
create table public.zzzs_editions (
  edition_year integer not null,
  edition_no integer not null,
  published_on date,
  comment text,
  loaded_at timestamptz not null default now(),
  primary key (edition_year, edition_no)
);

create table public.zzzs_services (
  id uuid primary key default gen_random_uuid(),
  list_code text not null,            -- e.g. '15.119'
  list_name text not null,            -- e.g. 'Storitve zobozdravstvene dejavnosti za odrasle - zdravljenje'
  code text not null,                 -- e.g. '52321'
  short_name text not null,           -- 'Zalivka na 2 ploskvah'
  long_name text,
  unit_name text,                     -- 'Točka'
  points numeric(10,2),               -- for a later concession module; meaningless for private practices
  valid_from date not null,
  valid_to date,                      -- null = still valid in the latest edition
  edition_year integer not null,
  edition_no integer not null,
  unique (list_code, code, valid_from)
);
create index zzzs_services_code_idx on public.zzzs_services(code);

-- Reference data: every signed-in user may read it, nobody writes it through
-- the API (no insert/update/delete policies — only the service role loader).
alter table public.zzzs_editions enable row level security;
create policy zzzs_editions_select on public.zzzs_editions for select to authenticated using (true);
alter table public.zzzs_services enable row level security;
create policy zzzs_services_select on public.zzzs_services for select to authenticated using (true);

-- ---- Price list + settings ---------------------------------------------------
alter table public.services
  add column zzzs_code text check (zzzs_code is null or zzzs_code ~ '^[0-9A-Za-z]{1,10}$');
create index services_practice_zzzs_code_idx on public.services(practice_id, zzzs_code) where zzzs_code is not null;

alter table public.invoice_settings
  add column use_zzzs_sifrant boolean not null default false,
  -- Reserved for the concession module (ZZZS contract); nothing reads it yet.
  add column zzzs_contract boolean not null default false;

-- ---- Chart mark → service links ------------------------------------------------
-- trigger_key is the chart's own vocabulary (ToothStatus / EndoStage / post /
-- perio measurements), not a billing taxonomy. variant is used only where the
-- chart itself decides it: the filling's surface count ('1', '2', '3+').
-- excluded = true records that the practice removed an AUTOMATIC link (one
-- derived from the service's ZZZS code), so it isn't re-added.
create table public.service_chart_links (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  trigger_key text not null check (trigger_key in (
    'filling', 'extraction', 'root_canal', 'crown', 'overlay', 'sealant',
    'bridge_pontic', 'post', 'prosthesis', 'implant', 'perio')),
  variant text check (variant in ('1', '2', '3+')),
  service_id uuid not null references public.services(id) on delete cascade,
  excluded boolean not null default false,
  created_at timestamptz not null default now(),
  check ((trigger_key = 'filling') = (variant is not null))
);
create unique index service_chart_links_unique_idx
  on public.service_chart_links(practice_id, trigger_key, coalesce(variant, ''), service_id);
create index service_chart_links_service_id_idx on public.service_chart_links(service_id);

-- The service must belong to the same practice (the FK alone accepts a
-- guessed id from another practice).
create or replace function public.check_service_chart_link()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.services s where s.id = new.service_id and s.practice_id = new.practice_id
  ) then
    raise exception 'service does not belong to this practice';
  end if;
  return new;
end;
$$;
create trigger check_service_chart_link_trigger
  before insert or update on public.service_chart_links
  for each row execute function public.check_service_chart_link();

alter table public.service_chart_links enable row level security;
create policy service_chart_links_select on public.service_chart_links for select
  using (practice_id = public.current_practice_id());
create policy service_chart_links_insert on public.service_chart_links for insert
  with check (practice_id = public.current_practice_id());
create policy service_chart_links_update on public.service_chart_links for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy service_chart_links_delete on public.service_chart_links for delete
  using (practice_id = public.current_practice_id());

-- ---- Performed services --------------------------------------------------------
-- One row per chart change billed from a visit: a filled tooth, an
-- extraction, a perio session (tooth_fdi null = whole mouth). The unique index
-- keeps one row per visit + tooth + mark, so the same work can't be recorded
-- twice; re-billing after a storno reuses the row. practice_id is stamped from
-- the patient, never sent by the client.
create table public.performed_services (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid not null references public.visits(id) on delete cascade,
  tooth_fdi text check (tooth_fdi is null or tooth_fdi ~ '^[1-8][1-8]$'),
  trigger_key text not null check (trigger_key in (
    'filling', 'extraction', 'root_canal', 'crown', 'overlay', 'sealant',
    'bridge_pontic', 'post', 'prosthesis', 'implant', 'perio')),
  variant text check (variant in ('1', '2', '3+')),
  service_id uuid references public.services(id),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  performed_on date not null,
  -- 'zzzs' is reserved for the concession module; for now always 'patient'.
  payer text not null default 'patient' check (payer in ('patient', 'zzzs')),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index performed_services_visit_item_idx
  on public.performed_services(visit_id, coalesce(tooth_fdi, ''), trigger_key);
create index performed_services_practice_id_idx on public.performed_services(practice_id);
create index performed_services_patient_id_idx on public.performed_services(patient_id);

create or replace function public.prepare_performed_service()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select practice_id into new.practice_id from public.patients where id = new.patient_id;
  if new.practice_id is null then raise exception 'patient not found'; end if;
  if not exists (select 1 from public.visits v where v.id = new.visit_id and v.patient_id = new.patient_id) then
    raise exception 'visit does not belong to this patient';
  end if;
  if new.service_id is not null and not exists (
    select 1 from public.services s where s.id = new.service_id and s.practice_id = new.practice_id
  ) then
    raise exception 'service does not belong to this practice';
  end if;
  return new;
end;
$$;
create trigger prepare_performed_service_trigger
  before insert or update on public.performed_services
  for each row execute function public.prepare_performed_service();

alter table public.performed_services enable row level security;
create policy performed_services_select on public.performed_services for select
  using (practice_id = public.current_practice_id());
create policy performed_services_insert on public.performed_services for insert
  with check (practice_id = public.current_practice_id());
create policy performed_services_update on public.performed_services for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy performed_services_delete on public.performed_services for delete
  using (practice_id = public.current_practice_id());

-- ---- Invoice lines ---------------------------------------------------------------
-- Not unique: saveDraft() writes the new lines before deleting the old ones,
-- so a draft briefly holds two lines for the same performed service. A
-- performed service counts as billed while a line on a non-cancelled invoice
-- points at it. "on delete set null" can't strip an issued line — the line
-- guard below rejects any change to an issued invoice's lines — so a billed
-- performed service effectively can't be deleted.
alter table public.invoice_lines
  add column performed_service_id uuid references public.performed_services(id) on delete set null;
create index invoice_lines_performed_service_id_idx on public.invoice_lines(performed_service_id)
  where performed_service_id is not null;

-- Same as 023's version, plus: the performed service must belong to the same
-- practice.
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
  if new.performed_service_id is not null and not exists (
    select 1 from public.performed_services p where p.id = new.performed_service_id and p.practice_id = v_practice
  ) then
    raise exception 'performed service does not belong to this practice';
  end if;

  new.practice_id := v_practice;
  new.line_total_eur := round(new.quantity * new.unit_price_eur * (1 - new.discount_percent / 100), 2);
  return new;
end;
$$;

-- Same as 029's version, plus performed_service_id copied onto the credit
-- note's lines.
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

  insert into public.invoice_lines (invoice_id, position, service_id, code, name, unit, vat_rate, tooth_fdi, quantity, unit_price_eur, discount_percent, performed_service_id)
  select v_new, position, service_id, code, name, unit, vat_rate, tooth_fdi, -quantity, unit_price_eur, discount_percent, performed_service_id
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
