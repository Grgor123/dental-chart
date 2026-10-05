-- Health questionnaire: send it when an appointment is CONFIRMED, not when it's
-- booked (Gregor's explicit choice, 2026-10-05).
--
-- An appointment becomes 'confirmed' when the patient taps "Pridem" in the SMS
-- reminder (appointment-confirm, ~2 days before) or staff set "Potrjen". At
-- that moment the questionnaire email goes out — but only if the patient has
-- none submitted in the last 12 months and no link already open (the rules
-- live in supabase/functions/_shared/email/sendQuestionnaireEmail.ts).
-- Patients who never confirm don't get it automatically; staff can still use
-- "Pošlji vprašalnik".
--
-- Same pg_net + Vault pattern as send_appointment_change_email() (019).
-- Redeploy after running this:
--   - send-health-questionnaire            now also accepts this trigger's call
--   - send-appointment-confirmation-email  no longer sends it on booking
begin;

create or replace function public.send_questionnaire_on_confirmation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_service_role_key text;
begin
  -- Only the transition INTO 'confirmed' (or an appointment created already
  -- confirmed), never a re-save of an already confirmed one.
  if new.status <> 'confirmed' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' then
    return new;
  end if;

  select decrypted_secret into v_service_role_key
    from vault.decrypted_secrets where name = 'edge_function_service_role_key';

  if v_service_role_key is not null then
    perform net.http_post(
      url := 'https://aqubyxhudwxhfkhihgtk.supabase.co/functions/v1/send-health-questionnaire',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role_key),
      body := jsonb_build_object('appointmentId', new.id)
    );
  end if;

  return new;
end;
$$;

create trigger send_questionnaire_on_confirmation_trigger
  after insert or update of status on public.appointments
  for each row execute function public.send_questionnaire_on_confirmation();

commit;
