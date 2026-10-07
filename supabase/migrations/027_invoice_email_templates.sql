-- Editable wording for the invoice email (E-pošta → "Račun" and "Dobropis"
-- tabs, and "Shrani kot privzeto besedilo" in the send window). The overrides
-- live in email_templates like every other email; only the allowed keys grow.
begin;

alter table public.email_templates drop constraint if exists email_templates_template_key_check;
alter table public.email_templates add constraint email_templates_template_key_check check (template_key in (
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancelled',
  'appointment_rescheduled',
  'post_visit',
  'recall',
  'health_questionnaire',
  'invoice',
  'credit_note'
));

commit;
