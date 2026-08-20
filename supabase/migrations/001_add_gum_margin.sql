-- Adds gingival margin (GM) tracking, alongside the existing pocket depth
-- (PD) columns. Run this once in the Supabase SQL Editor — your tables
-- already exist from schema.sql, so this ALTERs them instead of recreating.
alter table tooth_records
  add column if not exists gum_margin_buccal int[] default '{0,0,0}',
  add column if not exists gum_margin_lingual int[] default '{0,0,0}';
