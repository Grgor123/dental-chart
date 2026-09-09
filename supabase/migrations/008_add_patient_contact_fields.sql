-- Adds patient contact/admin fields Gregor flagged as missing: phone,
-- email, address, and a health-insurance-card number (št. zdravstvene
-- kartice / ZZZS). All four are plain optional text columns — none of them
-- are read or validated anywhere in the app yet. The health-card number in
-- particular is captured purely for future use, ahead of eventual ZZZS/
-- eZdravje integration, which stays explicitly out of scope for Phase 1
-- (see CLAUDE.md).
--
-- Run this once in the Supabase SQL Editor against the live "Dental
-- charting" project.
alter table patients add column if not exists phone text;
alter table patients add column if not exists email text;
alter table patients add column if not exists address text;
alter table patients add column if not exists health_card_number text;
