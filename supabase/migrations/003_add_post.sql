-- Adds the dental-post (zobni zatiček) flag — see ToothData.post and the
-- "Dental post" section of CLAUDE.md's "Tlorisni pogled" spec. Run this
-- once in the Supabase SQL Editor; your tables already exist from
-- schema.sql (plus migrations 001–002), so this ALTERs them instead of
-- recreating.
alter table tooth_records
  add column if not exists post boolean default false;
