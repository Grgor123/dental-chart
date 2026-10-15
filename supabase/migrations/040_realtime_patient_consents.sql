-- Live consent badges on the patient record (Gregor, 2026-10-15): when a
-- patient confirms marketing consent by email (039), SMS consent, or an email
-- bounces, the open patient page updates without a reload
-- (src/hooks/usePatientConsentStatus.ts). Same as 031: add the tables to the
-- supabase_realtime publication — Realtime still applies RLS, so a practice
-- only ever receives its own rows.
begin;

do $$
declare
  t text;
begin
  foreach t in array array['patients', 'marketing_consent_requests'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

commit;
