-- Live updates for the patient record's "Sporočila" tab: the browser
-- subscribes to changes on the three message tables through Supabase
-- Realtime, so a newly logged message or a delivery report (SES / Lertify
-- webhook updating the row) shows up within a second, without polling.
-- Realtime applies each table's RLS policies, so a browser only ever hears
-- about its own practice's rows. Safe to run twice.
begin;

do $$
declare
  t text;
begin
  foreach t in array array['email_log', 'appointment_reminders', 'patient_sms_consents'] loop
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
