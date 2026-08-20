-- Adds the fissure-sealant (zalitje fisur) field — see ToothData.sealant /
-- SealantStage and the "Bridge display, fissure sealant, and overlay"
-- section of CLAUDE.md. Run this once in the Supabase SQL Editor; your
-- tables already exist from schema.sql (plus migrations 001–003), so this
-- ALTERs them instead of recreating.
-- Three-stage text field ('planned'/'done'/'existing'), not a boolean —
-- sealant started as a plain present/absent flag (always the grey
-- "existing" look) before Monika's explicit request to extend the same
-- planned/done/existing pattern used elsewhere on the chart to it too.
alter table tooth_records
  add column if not exists sealant text check (sealant in ('planned','done','existing'));
