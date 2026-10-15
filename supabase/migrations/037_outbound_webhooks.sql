-- Outbound webhooks (Nastavitve → Integracije): tell an external tool —
-- FluentCRM's incoming webhook, Make/Zapier/n8n, Brevo … — when a patient
-- gives marketing consent, so the autoresponder can add them as a contact.
--
-- Gregor's choices (2026-10-14):
--   - one event for now: consent_granted (patients.marketing_consent false →
--     true, which only the patient can do — on the health questionnaire);
--   - tags come later (the payload already carries an empty "tags" list);
--   - only owners set webhooks up;
--   - "Pošlji obstoječe" sends every patient who already consented, on demand.
--
-- Only consented patients are ever sent, and only contact data (name, email,
-- phone) — never anything clinical. The consent is re-checked at the moment of
-- sending, so a withdrawal before a retry stops it.
--
-- Delivery: rows in webhook_deliveries (an outbox) are posted by the
-- deliver-webhooks Edge Function — immediately (pg_net from the trigger /
-- backfill) and every 5 minutes by cron for retries. Each request is signed
-- with the webhook's own secret (HMAC-SHA256).
--
-- Deploy after running this: supabase functions deploy deliver-webhooks
begin;

-- The signed-in user's role in their practice (RLS helper, like
-- current_practice_id()).
create or replace function public.current_practice_role()
returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select role from public.practice_members
  where user_id = auth.uid() and practice_id = public.current_practice_id()
  limit 1
$$;
revoke all on function public.current_practice_role() from public;
grant execute on function public.current_practice_role() to authenticated;

create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  name text not null check (length(trim(name)) between 1 and 80),
  url text not null check (url ~ '^https://[^\s]+$' and length(url) <= 2000),
  events text[] not null default '{consent_granted}' check (events <@ array['consent_granted']::text[]),
  -- Shared with the receiver to check the X-Webhook-Signature header.
  secret text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index webhooks_practice_id_idx on public.webhooks(practice_id);

alter table public.webhooks enable row level security;
-- Owners only — a webhook sends patient contact data out of the app.
create policy webhooks_select on public.webhooks for select
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy webhooks_insert on public.webhooks for insert
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy webhooks_update on public.webhooks for update
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner')
  with check (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');
create policy webhooks_delete on public.webhooks for delete
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  webhook_id uuid not null references public.webhooks(id) on delete cascade,
  event text not null check (event in ('consent_granted', 'test')),
  -- 'trigger' (live event), 'backfill' ("Pošlji obstoječe"), 'test'.
  origin text not null default 'trigger' check (origin in ('trigger', 'backfill', 'test')),
  patient_id uuid references public.patients(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'delivered', 'failed', 'skipped')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  payload jsonb,              -- what was actually sent (last attempt)
  response_status int,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index webhook_deliveries_due_idx on public.webhook_deliveries(next_attempt_at) where status in ('pending', 'sending');
create index webhook_deliveries_webhook_idx on public.webhook_deliveries(webhook_id, created_at desc);

alter table public.webhook_deliveries enable row level security;
-- Read-only for owners (the delivery log); only the Edge Function writes.
create policy webhook_deliveries_select on public.webhook_deliveries for select
  using (practice_id = public.current_practice_id() and public.current_practice_role() = 'owner');

-- Wake the deliver-webhooks function now (the cron job is the safety net).
create or replace function public.kick_webhook_delivery()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_service_role_key text;
begin
  select decrypted_secret into v_service_role_key
    from vault.decrypted_secrets where name = 'edge_function_service_role_key';
  if v_service_role_key is not null then
    perform net.http_post(
      url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/deliver-webhooks',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role_key),
      body := '{"processQueue": true}'::jsonb
    );
  end if;
end;
$$;
revoke execute on function public.kick_webhook_delivery() from public, anon, authenticated;

-- consent_granted: marketing_consent turned on.
create or replace function public.enqueue_webhook_consent_granted()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  if not new.marketing_consent then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.marketing_consent then
    return new;
  end if;
  insert into public.webhook_deliveries (practice_id, webhook_id, event, origin, patient_id)
  select w.practice_id, w.id, 'consent_granted', 'trigger', new.id
  from public.webhooks w
  where w.practice_id = new.practice_id and w.enabled and 'consent_granted' = any(w.events);
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.kick_webhook_delivery();
  end if;
  return new;
end;
$$;

create trigger enqueue_webhook_consent_granted_trigger
  after insert or update of marketing_consent on public.patients
  for each row execute function public.enqueue_webhook_consent_granted();

-- "Pošlji obstoječe": queue every patient who currently has consent (skipping
-- those already waiting in this webhook's queue). Owner only.
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
revoke execute on function public.queue_webhook_backfill(uuid) from public, anon;
grant execute on function public.queue_webhook_backfill(uuid) to authenticated;

-- Hand the function a batch of due deliveries, marking them 'sending' so a
-- second concurrent run can't post the same one twice. A row stuck in
-- 'sending' for 5 minutes (function crashed) is due again. Service role only.
create or replace function public.claim_webhook_deliveries(p_limit int)
returns setof public.webhook_deliveries
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update public.webhook_deliveries d
  set status = 'sending', locked_at = now()
  where d.id in (
    select id from public.webhook_deliveries
    where next_attempt_at <= now()
      and (status = 'pending' or (status = 'sending' and locked_at < now() - interval '5 minutes'))
    order by next_attempt_at
    limit p_limit
    for update skip locked
  )
  returning d.*;
end;
$$;
revoke execute on function public.claim_webhook_deliveries(int) from public, anon, authenticated;
grant execute on function public.claim_webhook_deliveries(int) to service_role;

-- Retries: every 5 minutes.
select cron.schedule(
  'deliver-webhooks',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/deliver-webhooks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key')
    ),
    body := '{"processQueue": true}'::jsonb
  );
  $$
);

commit;
