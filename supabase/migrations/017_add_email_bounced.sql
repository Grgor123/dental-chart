-- Flags a patient whose email address hard-bounced, so the Patient Record
-- page can show "Preveri email naslov" next to the E-pošta field. Distinct
-- from email_opt_out (migration 016): a bounce also sets email_opt_out
-- (ses-bounce-webhook), but a patient who simply unsubscribed must NOT be
-- told their address is wrong, so the two need separate flags.
--
-- Set by ses-bounce-webhook on a PERMANENT bounce only (a complaint means
-- the patient dislikes the email, not that the address is invalid; a
-- transient bounce isn't a real signal). Cleared automatically when the
-- email address is edited — the trigger below — since a corrected address
-- deserves a fresh chance.
--
-- Note: clearing this flag does NOT re-enable email_opt_out. After fixing a
-- bounced address, staff still click "Ponovno omogoči" on the patient
-- record to resume sending.
begin;

alter table public.patients
  add column email_bounced boolean not null default false;

create or replace function public.reset_email_bounced_on_email_change()
returns trigger language plpgsql as $$
begin
  if new.email is distinct from old.email then
    new.email_bounced := false;
  end if;
  return new;
end;
$$;
create trigger reset_email_bounced_on_email_change_trigger
  before update of email on public.patients
  for each row execute function public.reset_email_bounced_on_email_change();

-- Backfill: patients who were auto-opted-out and have a bounced log row.
-- email_log.status = 'bounced' also covers transient bounces, but only a
-- permanent bounce ever sets email_opt_out automatically, so requiring
-- both keeps this close to accurate for anything bounced before this
-- migration existed.
update public.patients p
set email_bounced = true
where p.email_opt_out = true
  and exists (
    select 1 from public.email_log l
    where l.patient_id = p.id and l.status = 'bounced'
  );

commit;
