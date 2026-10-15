-- Tags removed again (Gregor, 2026-10-15: "too complicated, nobody would
-- understand it") and replaced by something simpler: an "email_sent" webhook
-- event. Whenever the app sends one of the email types an integration has
-- ticked (e.g. the recall or the thank-you after a visit) to a patient WITH
-- marketing consent, the webhook goes out with the email type as "tag", so a
-- tool like FluentCRM can tag the contact. Only the type, never the content.
--
-- Undoes 041 (tables, triggers, nightly job, tag webhook events); keeps 042
-- (inbound API). Written with "if exists" so it also works on a database built
-- from schema.sql, where 041 is no longer baked in.
--
-- Redeploy after running this: supabase functions deploy deliver-webhooks
begin;

-- ---- Remove tags (041) -------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'refresh-activity-tags';
drop trigger if exists tag_patient_on_invoice_issued_trigger on public.invoices;
drop table if exists public.patient_tags;
drop table if exists public.tags;
drop function if exists public.tag_patient_on_invoice_issued();
drop function if exists public.refresh_activity_tags();
drop function if exists public.ensure_auto_tag(uuid, text, text);
drop function if exists public.enqueue_webhook_tag_change();
drop function if exists public.kick_webhooks_after_statement();
drop function if exists public.set_patient_tag_practice_id();
drop function if exists public.guard_tag_changes();

delete from public.webhook_deliveries where event in ('tag_added', 'tag_removed');
alter table public.webhook_deliveries drop column if exists tag_id;
alter table public.webhook_deliveries drop column if exists tag_name;

-- ---- email_sent ------------------------------------------------------------------------
alter table public.webhooks drop constraint if exists webhooks_events_check;
update public.webhooks
  set events = array(select e from unnest(events) e where e in ('consent_granted', 'consent_withdrawn'))
  where events && array['tag_added', 'tag_removed'];
-- A webhook that only had tag events keeps a valid event but is switched off.
update public.webhooks set events = array['consent_granted'], enabled = false where cardinality(events) = 0;
alter table public.webhooks add constraint webhooks_events_check
  check (cardinality(events) >= 1 and events <@ array['consent_granted', 'consent_withdrawn', 'email_sent']::text[]);

-- Which email types fire email_sent for this webhook (email_log.email_type).
alter table public.webhooks add column if not exists email_types text[] not null default '{}';

alter table public.webhook_deliveries drop constraint if exists webhook_deliveries_event_check;
alter table public.webhook_deliveries add constraint webhook_deliveries_event_check
  check (event in ('consent_granted', 'consent_withdrawn', 'email_sent', 'test'));
alter table public.webhook_deliveries add column if not exists email_type text;

-- An email logged as sent to a consented patient → queue for the webhooks that
-- ticked its type.
create or replace function public.enqueue_webhook_email_sent()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  if new.status <> 'sent' or new.patient_id is null then
    return new;
  end if;
  if not exists (select 1 from public.patients where id = new.patient_id and marketing_consent) then
    return new;
  end if;
  insert into public.webhook_deliveries (practice_id, webhook_id, event, origin, patient_id, email_type)
  select w.practice_id, w.id, 'email_sent', 'trigger', new.patient_id, new.email_type
  from public.webhooks w
  join public.patients p on p.id = new.patient_id and p.practice_id = w.practice_id
  where w.enabled and 'email_sent' = any(w.events) and new.email_type = any(w.email_types);
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.kick_webhook_delivery();
  end if;
  return new;
end;
$$;

drop trigger if exists enqueue_webhook_email_sent_trigger on public.email_log;
create trigger enqueue_webhook_email_sent_trigger
  after insert on public.email_log
  for each row execute function public.enqueue_webhook_email_sent();

commit;
