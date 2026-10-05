-- Price list (cenik): service categories + services, managed under
-- Nastavitve → Cenik. Foundation for invoicing and for the later
-- invoice-driven aftercare emails (a service's category will map to aftercare
-- "topics" — see CLAUDE.md → "Email templates (E-pošta)" → "Planned next").
--
-- Both are root tables like `therapists`/`patients`: there's no parent row to
-- inherit practice_id from, so the client sets it explicitly on insert (from
-- usePracticeContext()), and 4 explicit RLS policies keep every practice to its
-- own rows.
begin;

-- ---- Categories ---------------------------------------------------------------

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (practice_id, name)
);
create index service_categories_practice_id_idx on public.service_categories(practice_id);

-- ---- Services -----------------------------------------------------------------

create table public.services (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  -- Restrict (the default, stated explicitly): a category that still has
  -- services can't be deleted — staff move or archive them first.
  category_id uuid references public.service_categories(id) on delete restrict,
  code text,  -- šifra (a practice's own code, or later a ZZZS code)
  name text not null,
  description text,
  price_eur numeric(10,2) not null check (price_eur >= 0),
  -- Percent. 0 = exempt: health services are generally exempt from VAT in
  -- Slovenia, so that's the default; presets 0 / 5 / 9.5 / 22 in the UI. To be
  -- confirmed with the practice's accountant before invoicing relies on it.
  vat_rate numeric(4,1) not null default 0 check (vat_rate between 0 and 100),
  -- Archive instead of delete: invoices will reference services later.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index services_practice_code_idx
  on public.services(practice_id, lower(code)) where code is not null and code <> '';
create index services_practice_id_idx on public.services(practice_id);
create index services_category_id_idx on public.services(category_id);

-- A service may only point at a category of the SAME practice. The FK alone
-- would accept another practice's category id (RLS hides that row from the
-- client, but a guessed id still satisfies the FK), so check it explicitly.
create or replace function public.check_service_category_practice()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.service_categories c
    where c.id = new.category_id and c.practice_id = new.practice_id
  ) then
    raise exception 'category does not belong to this practice';
  end if;
  return new;
end;
$$;
create trigger check_service_category_practice_trigger
  before insert or update of category_id, practice_id on public.services
  for each row execute function public.check_service_category_practice();

-- ---- RLS ------------------------------------------------------------------------

alter table public.service_categories enable row level security;
create policy service_categories_select on public.service_categories for select
  using (practice_id = public.current_practice_id());
create policy service_categories_insert on public.service_categories for insert
  with check (practice_id = public.current_practice_id());
create policy service_categories_update on public.service_categories for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy service_categories_delete on public.service_categories for delete
  using (practice_id = public.current_practice_id());

alter table public.services enable row level security;
create policy services_select on public.services for select
  using (practice_id = public.current_practice_id());
create policy services_insert on public.services for insert
  with check (practice_id = public.current_practice_id());
create policy services_update on public.services for update
  using (practice_id = public.current_practice_id())
  with check (practice_id = public.current_practice_id());
create policy services_delete on public.services for delete
  using (practice_id = public.current_practice_id());

-- ---- Starter categories -----------------------------------------------------------

-- Every practice starts with a sensible set it can rename/add to/remove
-- (Gregor's explicit choice: practice-defined, with a starter set). SECURITY
-- DEFINER so it works from the signup trigger, which runs before the new user
-- has any RLS access. Only seeds a practice that has no categories yet, so
-- re-running it never duplicates or resurrects deleted ones.
create or replace function public.seed_default_service_categories(p_practice_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.service_categories where practice_id = p_practice_id) then
    return;
  end if;
  insert into public.service_categories (practice_id, name, sort_order) values
    (p_practice_id, 'Preventiva', 10),
    (p_practice_id, 'Diagnostika in RTG', 20),
    (p_practice_id, 'Restavrativa', 30),
    (p_practice_id, 'Endodontija', 40),
    (p_practice_id, 'Parodontologija', 50),
    (p_practice_id, 'Kirurgija', 60),
    (p_practice_id, 'Implantologija', 70),
    (p_practice_id, 'Protetika', 80),
    (p_practice_id, 'Ortodontija', 90);
end;
$$;

-- Backfill every existing practice...
do $$
declare
  p record;
begin
  for p in select id from public.practices loop
    perform public.seed_default_service_categories(p.id);
  end loop;
end;
$$;

-- ...and every future one: the same signup trigger function migration 011
-- created, now also seeding the starter categories.
create or replace function public.handle_new_user_practice()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  new_practice_id uuid;
  practice_name text;
begin
  practice_name := coalesce(nullif(trim(new.raw_user_meta_data->>'practice_name'), ''), 'New practice');
  practice_name := left(practice_name, 200);
  insert into practices (name) values (practice_name) returning id into new_practice_id;
  insert into practice_members (practice_id, user_id, role) values (new_practice_id, new.id, 'owner');
  perform public.seed_default_service_categories(new_practice_id);
  return new;
end;
$$;

commit;
