-- One "Pridem / Ne pridem" link per appointment, shared by the reminder email
-- and the SMS reminder (Gregor, 2026-11-11). Until now only the SMS carried
-- it (appointment_reminders.confirm_token); the reminder email (09:00) now has
-- the same link, so the token lives on the appointment and whichever message
-- goes out first creates it. appointment-confirm accepts it and, for older
-- SMS links, still the token on appointment_reminders.
-- Additive: older app versions never read the column.
begin;

alter table public.appointments
  add column confirm_token text unique check (confirm_token is null or length(confirm_token) between 8 and 64);

commit;
