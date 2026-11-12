-- Consents: QR code or email (Gregor, 2026-11-12). After the dentist confirms
-- the explanation, the patient signs on their own phone (or the practice's
-- tablet) by scanning the QR code shown in the practice, or at home from an
-- emailed link. Removed again before any use (no rows existed):
--   * paired signing tablets (059: signing_devices, its functions, the
--     device columns on patient_consents),
--   * signing in the app on this device (sign_consent_in_practice).
begin;

drop function if exists public.send_consent_to_device(uuid, uuid);
drop function if exists public.create_signing_device(text);
drop function if exists public.renew_signing_device_code(uuid);
drop function if exists public.revoke_signing_device(uuid);
drop function if exists public.new_pairing_code();
drop function if exists public.sign_consent_in_practice(uuid, text, text, text);

alter table public.patient_consents drop column if exists device_id;
alter table public.patient_consents drop column if exists device_requested_at;
drop table if exists public.signing_devices;

commit;
