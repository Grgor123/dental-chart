-- The exact text of every message sent to a patient, kept with its audit row
-- so the patient record's "Sporočila" tab can show what actually went out —
-- not a re-render from today's template or today's appointment time.
--   - email_log.body_html: the email's HTML body as sent (attachments such
--     as the invoice PDF or the .ics are not stored).
--   - appointment_reminders.message_text / patient_sms_consents.message_text:
--     the SMS text as sent.
-- Only messages sent after this migration have it; older rows stay null.
-- Same tables, same RLS: readable only by the practice the patient belongs to.
begin;

alter table public.email_log add column body_html text;
alter table public.appointment_reminders add column message_text text;
alter table public.patient_sms_consents add column message_text text;

commit;
