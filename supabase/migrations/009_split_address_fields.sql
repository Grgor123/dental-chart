-- Splits the patient address into three fields, per Monika's explicit
-- request: `address` stays as the street + house number line (no rename,
-- no data migration needed for whatever's already in it), and two new
-- columns hold the postal code and city separately.
--
-- Run this once in the Supabase SQL Editor against the live "Dental
-- charting" project.
alter table patients add column if not exists postal_code text;
alter table patients add column if not exists city text;
