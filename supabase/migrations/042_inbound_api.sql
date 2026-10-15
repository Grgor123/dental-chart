-- Inbound API (Nastavitve → Integracije → API ključi), Gregor's choices
-- 2026-10-15: per-key permissions; for now one permission — "unsubscribe":
-- an external tool (FluentCRM, Make, Zapier …) reports that someone
-- unsubscribed there, and the app sets marketing_consent = false for that
-- email (source 'api'). The API can never GRANT consent.
--
-- Keys are generated in the browser and shown once; only a SHA-256 hash and a
-- short prefix are stored. Owners only. The public-api Edge Function checks the
-- key with the service role.
--
-- Deploy after running this: supabase functions deploy public-api --no-verify-jwt
begin;

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  name text not null check (length(trim(name)) between 1 and 80),
  prefix text not null,                    -- first characters, to recognise a key
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (cardinality(scopes) >= 1 and scopes <@ array['unsubscribe']::text[]),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  use_count int not null default 0,
  revoked_at timestamptz
);
create index api_keys_practice_id_idx on public.api_keys(practice_id);

alter table public.api_keys enable row level security;
create policy api_keys_select on public.api_keys for select
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy api_keys_insert on public.api_keys for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy api_keys_update on public.api_keys for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy api_keys_delete on public.api_keys for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

-- From the browser only the name can change and the key be revoked; the hash,
-- scopes and usage stay as created (usage is written by the function).
create or replace function public.guard_api_key_changes()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.key_hash <> old.key_hash or new.prefix <> old.prefix or new.scopes <> old.scopes
     or new.practice_id <> old.practice_id or new.use_count <> old.use_count
     or new.last_used_at is distinct from old.last_used_at then
    raise exception 'api_key_immutable';
  end if;
  if old.revoked_at is not null and new.revoked_at is null then
    raise exception 'api_key_revoked';
  end if;
  return new;
end;
$$;
create trigger guard_api_key_changes_trigger
  before update on public.api_keys
  for each row execute function public.guard_api_key_changes();

alter table public.patients drop constraint if exists patients_marketing_consent_source_check;
alter table public.patients add constraint patients_marketing_consent_source_check
  check (marketing_consent_source in ('questionnaire', 'staff', 'email', 'unsubscribe', 'api'));

commit;
