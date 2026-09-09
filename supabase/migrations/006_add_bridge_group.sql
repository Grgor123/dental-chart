-- Persists which teeth are explicitly linked into one bridge — see
-- CLAUDE.md's "Bridge display" section (bridgeGroupByFdi,
-- handleCreateBridge/PatientChart.tsx, findBridgeGroups/BridgeRow.tsx).
-- Until now this only ever lived in local React state, so a bridge
-- (the "Člen mostu" bracket connecting an anchor to its pontics) vanished
-- on every page reload even though every other field on the chart already
-- persisted. A plain text column, not a foreign key to some separate
-- "bridge_groups" table — the group id itself has no meaning beyond "these
-- rows share the same value" (see handleCreateBridge's own comment on how
-- it's generated), so there's nothing else for a foreign key to point at.
--
-- Run this once in the Supabase SQL Editor; your tables already exist from
-- schema.sql (plus, if this is the older project this app used to share
-- before the split — see CLAUDE.md's "Supabase Schema" section — migrations
-- 001–005).
alter table tooth_records
  add column if not exists bridge_group_id text;
