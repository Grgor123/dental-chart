-- Two things (Gregor, 2026-11-11):
--
-- 1. The practice's contact email (replies to every automatic email go there —
--    it's their Reply-To; the sending address obvestila@… has no mailbox).
--    practices has no update policy (it also holds the sending-domain
--    columns), so owners set just this one column through a function.
--
-- 2. "Pošlji e-pošto in SMS za potrditev termina" — a checkbox when booking
--    (phone bookings, rebooked patients) that asks for a confirmation outside
--    the regular reminder times: the reminder email with the "Pridem / Ne
--    pridem" link goes out at once, the SMS 2 hours later if still
--    unanswered (08:00–20:00 only). appointments.confirm_requested_at is set
--    by the app; a trigger sends the email; send-appointment-reminders (now
--    every 15 minutes) sends the SMS. An appointment can therefore get more
--    than one reminder: the one-per-appointment unique indexes on
--    appointment_reminders and email_log (reminder type) become plain ones.
-- Additive for older app versions.
begin;

-- ---- 1. Contact email
create or replace function public.set_practice_contact_email(p_email text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_email text := nullif(trim(p_email), '');
begin
  if public.current_practice_role() is distinct from 'owner' then
    raise exception 'Samo lastnik lahko spremeni kontaktni naslov.' using errcode = '42501';
  end if;
  if v_email is not null and v_email !~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$' then
    raise exception 'E-poštni naslov ni pravilen.' using errcode = '22023';
  end if;
  update public.practices set contact_email = lower(v_email) where id = public.current_practice_id();
end;
$$;
revoke all on function public.set_practice_contact_email(text) from public;
grant execute on function public.set_practice_contact_email(text) to authenticated;

-- ---- 2. Confirmation request
alter table public.appointments add column confirm_requested_at timestamptz;

drop index public.appointment_reminders_appointment_id_idx;
create index appointment_reminders_appointment_id_idx on public.appointment_reminders(appointment_id, sent_at);
-- The SMS now carries the appointment's own token (052), so a second SMS for
-- the same appointment repeats it.
alter table public.appointment_reminders drop constraint appointment_reminders_confirm_token_key;
create index appointment_reminders_confirm_token_idx on public.appointment_reminders(confirm_token);

drop index public.email_log_appointment_id_email_type_idx;
create unique index email_log_appointment_id_email_type_idx
  on public.email_log(appointment_id, email_type)
  where appointment_id is not null and email_type not in ('appointment_rescheduled', 'appointment_reminder');
create index email_log_appointment_reminder_idx
  on public.email_log(appointment_id, sent_at)
  where email_type = 'appointment_reminder';

-- Ticking the box (insert or update) sends the reminder email right away.
create or replace function public.send_confirm_request_email()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.confirm_requested_at is not null
     and (tg_op = 'INSERT' or new.confirm_requested_at is distinct from old.confirm_requested_at) then
    perform net.http_post(
      url := public.edge_function_url('send-appointment-reminder-emails'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key')
      ),
      body := jsonb_build_object('appointmentId', new.id)
    );
  end if;
  return new;
end;
$$;
create trigger send_confirm_request_email_trigger
  after insert or update of confirm_requested_at on public.appointments
  for each row execute function public.send_confirm_request_email();

-- The SMS job runs every 15 minutes (the 2-hour SMS shouldn't wait up to an
-- hour); its regular 14:00 send still happens once — it skips appointments
-- that already got an SMS.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'send-appointment-reminders-hourly'),
  schedule := '*/15 * * * *'
);

commit;
