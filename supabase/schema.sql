-- Dental Practice Management App — Phase 1 schema
-- Paste this whole file into the Supabase SQL Editor (Project → SQL Editor →
-- New query) and click Run. Safe to run once on a fresh project — this
-- already includes everything from migrations 001-009 baked in directly
-- (gum margin, bleeding surfaces, dental post, endo, visit lifecycle,
-- bridge grouping, restricting sex to M/F, patient contact fields, split
-- address fields), so a brand-new project only needs this ONE file, not
-- this file plus nine migrations run afterward in order. The migrations/
-- folder stays as-is for a project that already has an OLDER version of
-- these tables and needs to catch up incrementally instead.
-- Source of truth: CLAUDE.md "Supabase Schema" section — keep both in sync.

-- Patients
create table patients (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  dob date not null,
  sex text check (sex in ('M','F')),  -- only two options offered, per Monika's explicit request — see migrations/007_restrict_sex_to_mf.sql for a project that already has the older 'other' value allowed
  phone text,
  email text,
  address text,        -- street + house number only — see postal_code/city below for the rest, per Monika's explicit request to split these
  postal_code text,
  city text,
  health_card_number text,  -- št. zdravstvene kartice (ZZZS) — captured for future use, not read anywhere in the app yet (eZdravje/ZZZS integration is a later phase — see CLAUDE.md's "Out of Scope for Phase 1")
  diagnoses text[] default '{}',
  created_at timestamptz default now()
);

-- Visits
create table visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  date date not null,
  notes text,
  created_at timestamptz default now(),
  closed_at timestamptz  -- null = still open (dentist may still be actively working in it — see CLAUDE.md's "Visit lifecycle"); set once, never un-set
);

-- Tooth records per visit — ONE ROW PER TOOTH PER VISIT, not one shared row
-- per tooth overall. See CLAUDE.md's "Visit lifecycle" section: this is
-- what gives per-tooth chronological history for free (every row for one
-- tooth_id, ordered by its visit's date, IS that tooth's history) with no
-- separate event-log table. While a visit is open, the app upserts THIS
-- SAME row on every autosave flush (on the unique constraint below) rather
-- than inserting a new one each time; once the visit closes, its rows are
-- never written to again.
create table tooth_records (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references visits(id) on delete cascade,
  tooth_id text not null,           -- FDI: '11', '36', etc.
  surfaces jsonb not null default '{}',
  pockets_buccal int[] default '{0,0,0}',
  pockets_lingual int[] default '{0,0,0}',
  gum_margin_buccal int[] default '{0,0,0}',   -- signed mm from CEJ; negative = recession
  gum_margin_lingual int[] default '{0,0,0}',
  bleeding_buccal boolean[] default '{false,false,false}',   -- bleeding on probing (BOP)
  bleeding_lingual boolean[] default '{false,false,false}',
  furcation smallint default 0,
  mobility smallint default 0,
  endo text check (endo in ('planned','done','existing')),  -- endodontsko zdravljenje (kanal) — see ToothData.endo / EndoStage — supersedes the older unused `canal boolean` column
  post boolean default false,       -- zobni zatiček — see ToothData.post
  bridge_group_id text,             -- which explicit bridge this tooth belongs to, if any — see CLAUDE.md's "Bridge display" (bridgeGroupByFdi); not a foreign key, the id itself has no meaning beyond "these rows share the same value"
  notes text,
  created_at timestamptz default now()
);

-- Unique INDEX (not an inline `unique` column constraint) so this stays
-- consistent with migration 005_add_visit_lifecycle.sql's own `create
-- unique index if not exists` — see that file's comment for why.
create unique index if not exists tooth_records_visit_tooth_unique
  on tooth_records (visit_id, tooth_id);

-- Treatment plan entries
create table treatment_entries (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references visits(id) on delete cascade,
  tooth_id text not null,
  surfaces text[],
  procedure text not null,
  price_eur numeric(8,2),
  status text check (status in ('planned','completed')) default 'planned',
  completed_date date,
  created_at timestamptz default now()
);

-- Row Level Security — enable on all tables
alter table patients enable row level security;
alter table visits enable row level security;
alter table tooth_records enable row level security;
alter table treatment_entries enable row level security;

-- Policy: only authenticated users (the dentist) can access
create policy "auth_only" on patients for all using (auth.role() = 'authenticated');
create policy "auth_only" on visits for all using (auth.role() = 'authenticated');
create policy "auth_only" on tooth_records for all using (auth.role() = 'authenticated');
create policy "auth_only" on treatment_entries for all using (auth.role() = 'authenticated');
