-- Adds the "is this visit still open?" concept the save/history design
-- needs (see CLAUDE.md's "Visit lifecycle" section): a visit stays open
-- while the dentist is actively working in it — every autosave flush
-- updates that SAME visit's own tooth_records rows in place — and closes
-- (on sign-out, switching patients, or a long inactivity timeout) once,
-- after which its rows are never touched again; the next edit starts a
-- fresh visit. This is what gives "one history entry per visit" per tooth
-- without a separate event-log table: tooth_records already has one row
-- per tooth per visit, so closing a visit is what turns that visit's rows
-- from a live draft into a permanent history entry.
--
-- Run this once in the Supabase SQL Editor; your tables already exist from
-- schema.sql (plus migrations 001–004).
alter table visits
  add column if not exists closed_at timestamptz;

-- One row per tooth per visit, not one-per-tooth-per-click — repeated
-- autosave flushes while a visit is open UPDATE this same row (upsert on
-- visit_id + tooth_id) instead of accumulating duplicates. Needed for the
-- app's supabase.upsert({ onConflict: 'visit_id,tooth_id' }) calls to work
-- atomically; without it, two flushes for the same tooth in the same open
-- visit would just insert two separate rows. A unique INDEX (rather than a
-- named `add constraint`) so this line is itself safe to run twice — `add
-- constraint` has no `if not exists` form in Postgres and would error on a
-- second run; Supabase's upsert(onConflict:) matches against any unique
-- index on these columns regardless of whether it backs a named
-- constraint.
create unique index if not exists tooth_records_visit_tooth_unique
  on tooth_records (visit_id, tooth_id);
