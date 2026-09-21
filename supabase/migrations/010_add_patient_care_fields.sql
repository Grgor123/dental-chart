-- Adds the two Patient Record fields (Frame 2 — see CLAUDE.md's "Patient
-- list" section once updated) that had no real column at all: which
-- dentist a patient is assigned to, and this practice's own internal
-- record number for them. Per Gregor's explicit request, neither is
-- hardcoded (e.g. always "Monika Novak") — both are plain, editable text
-- columns, same as every other patient field.
--
-- Run this once in the Supabase SQL Editor against the live "Dental
-- charting" project.
alter table patients add column if not exists assigned_dentist text;
alter table patients add column if not exists internal_record_number text;
