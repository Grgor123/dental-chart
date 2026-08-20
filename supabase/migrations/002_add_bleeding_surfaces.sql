-- Splits bleeding-on-probing (BOP) into separate buccal/lingual tracking,
-- matching the existing pockets_buccal/pockets_lingual and
-- gum_margin_buccal/gum_margin_lingual columns — pocket depth is now shown
-- on both surfaces, so BOP needs to be too. Run this once in the Supabase
-- SQL Editor; your tables already exist from schema.sql (plus migration
-- 001), so this ALTERs them instead of recreating.
alter table tooth_records
  add column if not exists bleeding_buccal boolean[] default '{false,false,false}',
  add column if not exists bleeding_lingual boolean[] default '{false,false,false}';

-- The old single-surface column was never populated (no writes exist yet),
-- so it's safe to drop rather than migrate.
alter table tooth_records
  drop column if exists bleeding;
