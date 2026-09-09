-- Restricts patients.sex to just 'M'/'F' — per Monika's explicit request,
-- no 'other' option is offered anywhere in the app (see Patient['sex'] in
-- types/dental.ts, and the sex dropdown in PatientList.tsx's new-patient
-- form). The column itself stays nullable — a patient with no sex entered
-- yet is still a legitimate, separate case (null), not a third value.
--
-- Run this once in the Supabase SQL Editor against the live "Dental
-- charting" project, which already has the older, more permissive
-- check constraint from schema.sql.
update patients set sex = null where sex = 'other';

alter table patients drop constraint if exists patients_sex_check;
alter table patients add constraint patients_sex_check check (sex in ('M','F'));
