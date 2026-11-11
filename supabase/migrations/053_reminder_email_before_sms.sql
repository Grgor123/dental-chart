-- The reminder email must go out before the SMS reminder (Gregor,
-- 2026-11-11): the SMS (2 days before, 14:00 Europe/Ljubljana —
-- send-appointment-reminders) is only sent when the email's "Pridem / Ne
-- pridem" link hasn't been answered. So a practice's reminder email may be
-- set to at least 2 days before, and on the 2nd day only before 14:00.
-- Null columns mean the defaults (2 days, 09:00). The E-pošta page checks the
-- same (reminderEmailBeforeSms in _shared/email/templateDefs.ts) — change both
-- together.
-- No existing row breaks it (checked: no reminder overrides yet).
begin;

alter table public.email_templates
  add constraint email_templates_reminder_before_sms check (
    template_key <> 'appointment_reminder'
    or coalesce(timing_value, 2) > 2
    or (coalesce(timing_value, 2) = 2 and coalesce(send_hour, 9) < 14)
  );

commit;
