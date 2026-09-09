-- Adds endodontic treatment (kanal) as its own column — see ToothData.endo /
-- EndoStage and the "Canal display" section of CLAUDE.md. Endo used to be
-- three mutually-exclusive ToothStatus values (endo/endo_planned/
-- endo_existing) sharing the surfaces jsonb column's `all` slot with every
-- other status; it's now an independent field so it can coexist with
-- whatever status a tooth already has (a filling AND a completed root
-- canal at once, say). This also drops the older `canal boolean` column
-- from the original schema.sql, which endo supersedes — unlike `post`/
-- `sealant`'s own migrations, this one really is an ALTER against a live
-- table, since `canal` was part of the very first schema.sql already
-- confirmed applied. Run this once in the Supabase SQL Editor; your tables
-- already exist from schema.sql (plus migrations 001–003).
alter table tooth_records
  drop column if exists canal;

alter table tooth_records
  add column if not exists endo text check (endo in ('planned','done','existing'));
