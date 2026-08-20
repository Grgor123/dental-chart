-- Dental Practice Management App — Phase 1 schema
-- Paste this whole file into the Supabase SQL Editor (Project → SQL Editor →
-- New query) and click Run. Safe to run once on a fresh project.
-- Source of truth: CLAUDE.md "Supabase Schema" section — keep both in sync.

-- Patients
create table patients (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  dob date not null,
  sex text check (sex in ('M','F','other')),
  diagnoses text[] default '{}',
  created_at timestamptz default now()
);

-- Visits
create table visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  date date not null,
  notes text,
  created_at timestamptz default now()
);

-- Tooth records per visit
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
  canal boolean default false,
  post boolean default false,       -- zobni kolček (zatič) — see ToothData.post
  sealant text check (sealant in ('planned','done','existing')),  -- zalitje fisur — see ToothData.sealant / SealantStage
  notes text,
  created_at timestamptz default now()
);

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
