-- Follow-up to 017: correcting a bounced email address now also re-enables
-- email sending, instead of leaving the patient opted out until staff click
-- "Ponovno omogoči". Safe because email_bounced is only ever set together
-- with an AUTOMATIC opt-out from a hard bounce — a patient who unsubscribed
-- themselves never has email_bounced = true, so a real unsubscribe is never
-- silently undone by an address edit.
create or replace function public.reset_email_bounced_on_email_change()
returns trigger language plpgsql as $$
begin
  if new.email is distinct from old.email and old.email_bounced then
    new.email_bounced := false;
    new.email_opt_out := false;
    new.email_opt_out_at := null;
  end if;
  return new;
end;
$$;
