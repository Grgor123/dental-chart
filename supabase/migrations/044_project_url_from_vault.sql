-- The project's own address comes from configuration, not code (Gregor,
-- 2026-10-19 — preparing separate development and production projects).
--
-- Until now every trigger and cron job that calls an Edge Function (pg_net)
-- had this project's URL written into it. They now call
-- public.edge_function_url('<name>'), which reads the Vault secret
-- "project_url" — set once per project:
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--
-- (development: https://aqubyxhudwxhfkhihgtk.supabase.co). This migration
-- refuses to run until it exists, then rewrites the existing functions and
-- cron jobs in place. A fresh project built from schema.sql gets the new form
-- directly — set the secret there before the first patient is saved.
begin;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then
    raise exception 'Najprej shranite naslov projekta: select vault.create_secret(''https://<ref>.supabase.co'', ''project_url'');';
  end if;
end
$$;

create or replace function public.edge_function_url(p_name text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select rtrim(decrypted_secret, '/') || '/functions/v1/' || p_name
  from vault.decrypted_secrets where name = 'project_url'
$$;
revoke all on function public.edge_function_url(text) from public, anon, authenticated;

-- Rewrite every function and cron job that still has the URL written in:
-- 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/<name>'
--   → public.edge_function_url('<name>')
do $$
declare
  r record;
  v_pattern constant text := '''https://aqubyxhudwxhfkhihgtk\.supabase\.co/functions/v1/([a-z0-9-]+)''';
  v_replacement constant text := 'public.edge_function_url(''\1'')';
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/%'
  loop
    execute regexp_replace(pg_get_functiondef(r.oid), v_pattern, v_replacement, 'g');
  end loop;

  for r in select jobid, command from cron.job where command like '%aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/%' loop
    perform cron.alter_job(r.jobid, command := regexp_replace(r.command, v_pattern, v_replacement, 'g'));
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%aqubyxhudwxhfkhihgtk%'
  ) or exists (select 1 from cron.job where command like '%aqubyxhudwxhfkhihgtk%') then
    raise exception 'A function or cron job still contains the project URL.';
  end if;
end
$$;

commit;
