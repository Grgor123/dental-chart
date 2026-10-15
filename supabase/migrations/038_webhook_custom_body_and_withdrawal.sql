-- Outbound webhooks, part 2 (Gregor, 2026-10-15) — run after 037:
--   - a second event, consent_withdrawn (marketing_consent true → false, e.g.
--     staff "Prekliči soglasje"), so the receiving tool stops marketing. It
--     carries only email + phone (no names), consent false;
--   - per webhook: which events it gets, its own JSON body with {placeholders}
--     (null = the standard body) and its own request headers (an API key …),
--     so any app's format can be matched, not just FluentCRM's.
--
-- Bodies are built in supabase/functions/_shared/webhookBody.ts.
-- Redeploy after running this: supabase functions deploy deliver-webhooks
begin;

alter table public.webhooks drop constraint webhooks_events_check;
alter table public.webhooks add constraint webhooks_events_check
  check (cardinality(events) >= 1 and events <@ array['consent_granted', 'consent_withdrawn']::text[]);

alter table public.webhooks
  add column body_template text check (body_template is null or length(body_template) <= 10000),
  add column headers jsonb not null default '{}'::jsonb check (jsonb_typeof(headers) = 'object');

alter table public.webhook_deliveries drop constraint webhook_deliveries_event_check;
alter table public.webhook_deliveries add constraint webhook_deliveries_event_check
  check (event in ('consent_granted', 'consent_withdrawn', 'test'));

-- Replaces 037's trigger function: both transitions.
create or replace function public.enqueue_webhook_consent_granted()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event text;
  v_count int;
begin
  if new.marketing_consent and (tg_op = 'INSERT' or not old.marketing_consent) then
    v_event := 'consent_granted';
  elsif tg_op = 'UPDATE' and old.marketing_consent and not new.marketing_consent then
    v_event := 'consent_withdrawn';
  else
    return new;
  end if;
  insert into public.webhook_deliveries (practice_id, webhook_id, event, origin, patient_id)
  select w.practice_id, w.id, v_event, 'trigger', new.id
  from public.webhooks w
  where w.practice_id = new.practice_id and w.enabled and v_event = any(w.events);
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.kick_webhook_delivery();
  end if;
  return new;
end;
$$;

-- 037's version, plus: only for a webhook that receives consent_granted.
create or replace function public.queue_webhook_backfill(p_webhook_id uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_webhook public.webhooks;
  v_count int;
begin
  if public.current_practice_role() is distinct from 'owner' then
    raise exception 'Samo lastnik ordinacije lahko pošilja podatke prek integracij.';
  end if;
  select * into v_webhook from public.webhooks
  where id = p_webhook_id and practice_id = public.current_practice_id();
  if v_webhook.id is null then
    raise exception 'Integracija ne obstaja.';
  end if;
  if not v_webhook.enabled then
    raise exception 'Integracija je izklopljena.';
  end if;
  if not ('consent_granted' = any(v_webhook.events)) then
    raise exception 'Integracija ne prejema dogodka »soglasje dano«.';
  end if;
  insert into public.webhook_deliveries (practice_id, webhook_id, event, origin, patient_id)
  select p.practice_id, v_webhook.id, 'consent_granted', 'backfill', p.id
  from public.patients p
  where p.practice_id = v_webhook.practice_id
    and p.marketing_consent
    and not exists (
      select 1 from public.webhook_deliveries d
      where d.webhook_id = v_webhook.id and d.patient_id = p.id and d.status in ('pending', 'sending')
    );
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.kick_webhook_delivery();
  end if;
  return v_count;
end;
$$;

commit;
