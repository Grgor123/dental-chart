# CLAUDE.md — Dental Practice Management App

> This file is the authoritative guide for this project. Read it fully before writing any code.
> When in doubt about conventions, architecture, or scope — refer here first.

---

## Project Overview

A web-based dental practice management application, originally built for one single-dentist private practice in Slovenia (**Monika**, the primary user/dentist) but since turned into a genuine multi-practice product — Gregor's explicit goal is a CRM + charting + invoicing platform sold to multiple dental practices, not just Monika's own. The app replaces paper-based patient records (EL 81 form) and must be usable during a clinical appointment — fast, clear, touch-friendly. See "Multi-tenancy" below for how the data model keeps every practice's data isolated from every other's.

**Phase 1 scope: Dental Chart only.**
Everything else (billing, CRM, appointments, ZZZS reporting) comes later — the multi-tenancy foundation is built ahead of those specifically so none of them need a disruptive schema migration once they start.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18 + Vite | TypeScript strict mode |
| Styling | Tailwind CSS v3 | No component library in Phase 1 |
| Charts / SVG | Custom SVG components | No third-party chart lib — `svg-path-properties` is the one exception, a small build-time path-geometry utility (see `ToothProfile.crownCenterX`), not a chart/rendering library |
| Backend | Supabase (EU region — Frankfurt) | Auth + DB + Storage |
| Language | TypeScript | Strict, no `any` |
| Package manager | npm | |
| Linting | ESLint + Prettier | Default Vite config |

---

## Project Structure

```
src/
  components/
    chart/
      DentalChart.tsx          # Main chart container — both arches
      ArchRow.tsx              # One arch: two quadrants + divider, composes
                                # the rows below into the per-arch stack
      PerioGraphRow.tsx        # One quadrant's side-view teeth + CEJ-aligned
                                # mm ruler + gumline + REC (gum margin) labels
      PocketDepthRow.tsx       # One quadrant's pocket-depth (PD) number row —
                                # rendered twice per quadrant (vestibular + oral)
      BridgeRow.tsx            # One quadrant's mostiček bracket(s) — reads
                                # an EXPLICIT fdi->group-id map
                                # (bridgeGroupByFdi, set only by
                                # handleCreateBridge in PatientChart.tsx),
                                # not inferred from adjacent statuses; also
                                # draws the fissure-sealant tilde and
                                # overlay's cap, sitting above TlorisRow
                                # (below it, upper arch)
      TlorisRow.tsx            # One quadrant's tlorisni-pogled squares
      NumberRow.tsx            # One quadrant's FDI number labels
      ToothTopView.tsx         # Single FDI square — tlorisni pogled; also
                                # exports hidesSurfaceDetail()
      ToothSideView.tsx        # Single anatomic profile — stranski pogled
                                # (also exports ToothSideViewContent, the
                                # <defs>/<g> content with no wrapping <svg>,
                                # reused inside PerioGraphRow's shared canvas)
      perioStyle.ts            # Shared PD color thresholds + mesial/mid/distal
                                # x-fractions, used by PerioGraphRow and
                                # PocketDepthRow so the two stay consistent;
                                # also the shared PerioPoint type +
                                # samePerioPoint() for click-to-focus entry
                                # (see "Perio data entry")
    ui/
      StatusSymbol.tsx         # x-cross / endo-circle glyphs
      StatusSwatch.tsx         # One status's icon+color, shared by
                                # StatusLegend/StatusToolbar/StatusPicker
      StatusLegend.tsx         # Color + symbol legend, all statuses
      StatusToolbar.tsx        # Always-visible status grid for the direct-
                                # chart-selection flow (PatientChart.tsx) —
                                # select target(s) on the chart, then click
                                # a status here to apply
      StatusPicker.tsx         # Inline status grid opened from
                                # ToothDetailPanel's own "Cel zob"/surface
                                # chips (the click-a-tooth flow)
      ToothDetailPanel.tsx     # Panel below the chart for a selected tooth —
                                # surface chips + StatusPicker + notes field
      SurfaceChip.tsx          # Clickable surface badge, shows its own
                                # resolved status
      PostSwatch.tsx           # Dental post (zobni zatiček) icon — a plain
                                # boolean field presented as one grid entry,
                                # same shape as a real status
      EndoSwatch.tsx           # Endodontic treatment (kanal) icon,
                                # parameterized by EndoStage — three grid
                                # entries (planned/done/existing)
      PatientBadge.tsx         # Name, age, diagnoses (not built yet)
      AppNavShell.tsx          # Shared turquoise top bar + white submenu —
                                # used by every signed-in page (real
                                # onSignOut + userLabel from
                                # usePracticeContext()) and
                                # PatientPageMockup.tsx (dev-only, zero
                                # props, fully inert) — see "Patient Record
                                # page" below
    calendar/
      TimeGrid.tsx             # Day/Week's shared hour grid — full 00-24h
                                # range inside its own fixed-height,
                                # internally-scrolling frame (sticky day/
                                # column header), column-agnostic (Day
                                # passes one column per therapist, Week one
                                # per day) — see "Native scheduling
                                # calendar" below
      AppointmentChip.tsx      # One appointment block — solid therapist
                                # color, tick/cross status badge, dashed
                                # border for "sent" — see "Native
                                # scheduling calendar" below
      TherapistPanel.tsx       # Sidebar "Terapevti:" panel — solid-color
                                # name chips (click to hide/show that
                                # therapist everywhere, not just Day), its
                                # own scrollable overflow, "+" add-
                                # therapist modal (fixed color palette)
      CalendarSearch.tsx       # Persistent, always-visible cross-date
                                # patient-name search box
      MonthOverview.tsx        # Lightweight month grid — day cells with
                                # small therapist-colored chips, click a
                                # day to jump into Day view
      MiniCalendar.tsx         # Sidebar mini month-picker, its own frame
                                # bottom-aligned with TherapistPanel's
  data/
    toothProfiles.ts           # Per-FDI silhouette/detail paths + on-screen
                                # sizing (real mm, not photo pixels — see
                                # "Stranski pogled" below); exports the shared
                                # PX_PER_MM / COLUMN_WIDTH / COLUMN_GAP
                                # constants every chart row is built from
    toothAnatomy.ts            # Real average adult crown/root length (mm) per
                                # tooth type, upper vs lower — the actual
                                # source of on-screen proportions
    toothMeta.ts               # FDI numbers, type (ant/post), root count, surface names
    tracedTeeth.json           # Raw per-FDI traced silhouette/detail path data
    statusStyles.ts            # Fill/border/symbol per ToothStatus
  types/
    dental.ts                  # All TypeScript types (see below)
  contexts/
    PracticeContext.tsx        # PracticeProvider + usePracticeContext() —
                                # wraps usePractice.ts so practiceId/
                                # practiceName are readable anywhere under
                                # the signed-in app without prop-threading —
                                # see "Multi-tenancy" below
  hooks/
    useAuth.ts                 # Supabase session state + signIn/signOut
    usePractice.ts             # Resolves the signed-in user's own practice
                                # (practice_members joined to practices) —
                                # see "Multi-tenancy" below
    usePatients.ts              # Loads every patient (RLS-scoped to the
                                # signed-in practice) + createPatient()/
                                # updatePatient() — see "Patient list" below
    useOpenVisit.ts             # Resolves/creates the visit a chosen
                                # patient's chart should load/save against
                                # — see "Visit lifecycle" below
    useVisit.ts                # Loads + saves one visit's tooth_records,
                                # plus closeVisit() — see "Visit lifecycle"
                                # below (fully built, not just designed)
    useToothHistory.ts          # One tooth's tooth_records rows across
                                # every one of a patient's visits, newest
                                # first — see "Visit lifecycle" below
    usePatientHistory.ts        # Same join, minus the tooth filter, grouped
                                # by visit instead — backs Frame 8 on the
                                # Patient Record page — see "Visit
                                # lifecycle" below
    useTherapists.ts            # Practice-scoped therapist list + create —
                                # see "Native scheduling calendar" below
    useAppointments.ts          # Appointment CRUD + range queries (one day,
                                # one week, or an arbitrary range for Month)
                                # — see "Native scheduling calendar" below
    useAppointmentSearch.ts     # Cross-date patient-name search backing
                                # CalendarSearch.tsx
  lib/
    supabase.ts                # Supabase client
    describeToothRecord.ts     # One tooth_records row -> its bullet-point
                                # summary strings — shared by
                                # ToothDetailPanel's "Zgodovina" tab and
                                # usePatientHistory.ts so the two can never
                                # disagree — see "Visit lifecycle" below
    appointmentStatus.ts        # Shared appointment status label/color/
                                # badge vocabulary — used by both
                                # Calendar.tsx's grid chips and
                                # PatientChart.tsx's Frame 5, so one status
                                # can never render two different ways — see
                                # "Native scheduling calendar" below
    calendarLayout.ts           # layoutOverlappingEvents() — pure column-
                                # packing algorithm for side-by-side
                                # overlapping appointments, shared by
                                # Day/Week — see "Native scheduling
                                # calendar" below
  pages/
    Login.tsx                  # Email/password sign-in screen
    PatientList.tsx             # Landing page after login — search/pick a
                                # patient or add a new one — see "Patient
                                # list" below
    PatientChart.tsx           # Main page — the full Patient Record layout
                                # (chart + status toolbar + perio entry +
                                # bridge creation + patient info + visit
                                # history + placeholder frames) for one
                                # chosen patient, loading from and
                                # autosaving to that patient's own
                                # resolved-or-created Supabase visit via
                                # useOpenVisit.ts + useVisit.ts — see
                                # "Patient Record page" and "Visit
                                # lifecycle" below
    PatientPageMockup.tsx       # Dev-only design sandbox for the Patient
                                # Record page layout — zero real data, same
                                # role StatusShowcase.tsx plays for the
                                # chart itself — see "Patient Record page"
                                # below
    StatusShowcase.tsx         # Temporary dev-only review page for visual QA —
                                # not part of the app's real navigation
    Calendar.tsx                # Native Day/Week/Month scheduling calendar
                                # (therapist columns, appointment creation/
                                # editing incl. inline new-patient) — see
                                # "Native scheduling calendar" below
```

---

## TypeScript Types (`src/types/dental.ts`)

```typescript
// Surface keys
export type PostSurface = 'b' | 'o' | 'l' | 'm' | 'd';   // bukalna, okluzalna, lingvalna, mezialna, distalna
export type AntSurface  = 'b' | 'l' | 'm' | 'd';          // labialna, lingvalna, mezialna, distalna
export type Surface = PostSurface | AntSurface;

// Tooth type
export type ToothType = 'ant' | 'post';

// All possible statuses for a surface or whole tooth. No 'perio' entry —
// periodontal disease is represented directly by the pocket-depth/gum-
// margin numbers and gumline in the perio graph, not a flat status color;
// a color swatch would only ever be a coarser, redundant summary of data
// the graph already shows precisely.
export type ToothStatus =
  | 'healthy'
  | 'caries'          // karies / poka — še ni sanirano
  | 'caries_treated'  // plomba — pravkar sanirano
  | 'filling'        // plomba — obstoječa (pred spremljanjem)
  | 'crown'          // prevleka / krona — tudi sidro mostu ali proteze
  | 'bridge_pontic'  // člen mostu
  | 'implant'
  | 'abrasion'       // abrazija
  | 'overlay_planned'  // predviden overlay
  | 'overlay'          // overlay — dokončan
  | 'overlay_existing'  // overlay — obstoječ (pred spremljanjem)
  | 'sealant_planned'  // zalitje fisur — predvideno
  | 'sealant'          // zalitje fisur — opravljeno
  | 'sealant_existing'  // zalitje fisur — obstoječe (pred spremljanjem)
  | 'extraction_planned'  // predvidena ekstrakcija — zob še prisoten
  | 'extracted'      // ekstrahiran — zob odstranjen
  | 'missing'        // manjkajoč (ni bil prisoten)
  | 'impacted'       // impaktiran (neizrastel)
  | 'prosthesis'         // zob v protezi (odstranljiva proteza, ne naravni zob)
  | 'prosthesis_crown';  // naravni zob s krono, nosilec proteze (proteza na kroni)

// Surface-level status map
export type SurfaceMap = Partial<Record<Surface, ToothStatus>> & { all?: ToothStatus };

// Pocket depths: [mesial, mid, distal] in mm. Each entry is nullable — see
// "Perio data entry" under "Perio graph" — to support ENTERING one point at
// a time: null at one index means "this specific point not yet entered,"
// distinct from the outer Record<string, PocketDepths> key being absent
// entirely ("this tooth has no data at all").
export type PocketDepths = [number | null, number | null, number | null];

// Gingival margin position relative to CEJ: [mesial, mid, distal] in mm.
// 0 = at the CEJ. Negative = receded apical to CEJ (root exposed — the
// common case, and what "luščenje - glajenje" is tracked against).
// Positive = gum sits coronal to CEJ (covering some crown). Nullable per
// point for the same partial-entry reason as PocketDepths above.
export type GumMargin = [number | null, number | null, number | null];

// Bleeding on probing (BOP): [mesial, mid, distal], one flag per probing
// point — same 3 points as PocketDepths, tracked per surface like pockets
// and gum margin, since BOP is clinically meaningful on both.
export type BleedingPoints = [boolean, boolean, boolean];

// Endodontic treatment lifecycle — same three-stage model as
// overlay_planned/overlay/overlay_existing and the sealant statuses:
// 'planned' (red) still needs doing / in progress, 'done' (blue) just
// completed, 'existing' (grey) a root canal already done before this
// practice started tracking the tooth. Kept independent of ToothStatus
// (ToothData.endo below) rather than folded into it — per Monika's
// explicit request that endodontic treatment combine freely with whatever
// else is going on for that tooth (a filling AND a completed root canal on
// the same tooth at once, say), which the earlier endo/endo_planned/
// endo_existing statuses couldn't do, since they competed with every other
// status for the single surfaces.all slot — see "Canal display" below for
// the full history of that change. Supersedes the older, unused `canal`
// boolean this field replaces.
export type EndoStage = 'planned' | 'done' | 'existing';

// Single tooth data
export interface ToothData {
  toothId: string;              // FDI number as string: '11', '36', etc.
  type: ToothType;
  surfaces: SurfaceMap;
  pockets: {
    buccal: PocketDepths;
    lingual: PocketDepths;
  };
  gumMargin?: {
    buccal: GumMargin;
    lingual: GumMargin;
  };
  bleeding?: {
    buccal: BleedingPoints;
    lingual: BleedingPoints;
  };
  furcation?: 0 | 1 | 2 | 3;
  mobility?: 0 | 1 | 2 | 3;
  endo?: EndoStage;  // endodontsko zdravljenje (kanal) — see EndoStage above
  post?: boolean;  // zobni zatiček — vstavljen v koreninski kanal
  notes?: string;
  rootCount: number;
}

// Visit record
export interface VisitRecord {
  visitId: string;
  patientId: string;
  date: string;                 // ISO date
  dentistId: string;
  teeth: ToothData[];
  notes?: string;
  treatmentPlanned?: TreatmentEntry[];
  treatmentCompleted?: TreatmentEntry[];
}

// Treatment entry
export interface TreatmentEntry {
  toothId: string;
  surface?: Surface[];
  procedure: string;
  priceEur?: number;
  status: 'planned' | 'completed';
  date?: string;
}

// Patient
export interface Patient {
  patientId: string;
  firstName: string;
  lastName: string;
  dob: string;                  // ISO date
  sex: 'M' | 'F';                // per Monika's explicit request, only these two are offered — no 'other' option
  phone?: string;
  email?: string;
  // Address split into three fields — street (+ house number), postal
  // code, city — rather than one free-text line, per Monika's explicit
  // request. Checked the sibling "dental calendar" booking app first; its
  // own intake form doesn't collect a postal address at all, so this
  // three-way split is this app's own, not a matched convention.
  address?: string;      // street + house number only, e.g. "Slovenska cesta 15"
  postalCode?: string;   // e.g. "1000"
  city?: string;         // e.g. "Ljubljana"
  // Št. zdravstvene kartice (ZZZS) — a 9-digit number, captured at patient
  // creation for future use only; nothing in the app reads or validates
  // this yet beyond the input itself being digit-only/capped at 9 chars
  // (see PatientList.tsx) — eZdravje/ZZZS integration is a later phase,
  // see "Out of Scope for Phase 1" below.
  healthCardNumber?: string;
  diagnoses: string[];
  visits: VisitRecord[];
}
```

---

## Supabase Schema

**This app now has its own dedicated Supabase project ("Dental charting"),
separate from the appointment-scheduling/consent-storage app** (built in
earlier work this session has no memory of — a different conversation,
documented at `C:\Users\Uporabnik\Documents\Claude code dental calendar`).
The two used to unintentionally share one Supabase project — its
`booking_consents`/`sms_reminders` tables have nothing to do with the
dental chart, but sat in the same database as `patients`/`visits`/
`tooth_records`/`treatment_entries` regardless, which caused real
confusion (a `schema.sql` run failing with "relation patients already
exists" against tables that turned out to belong to the *other* app) and a
real security gap (that app's backend holds a Supabase **service-role**
key, which bypasses Row Level Security entirely — it could read/write this
app's clinical data too, not just its own two tables). Split into a
separate project per Monika's explicit decision once this was flagged —
see "Current Status & Next Steps" for the move itself. `supabase/schema.sql`
was run directly (unmodified — the new project was genuinely empty) rather
than the `migrations/` folder, which stays in the repo only for reference/
any other project that might ever need to catch up incrementally instead.
Everything added *after* that initial run (restricting `sex` to M/F,
`phone`/`email`/`address`/`postal_code`/`city`/`health_card_number` on
`patients`, then `assigned_dentist`/`internal_record_number`, then the full
multi-tenancy foundation below, then the native scheduling calendar's
`appointments`/`therapists` tables — see "Native scheduling calendar"
below) landed on the live project as its own migrations —
`007_restrict_sex_to_mf.sql` through `014_add_therapists.sql` — all
confirmed run. `supabase/schema.sql` itself is kept in sync to bake in
everything through the latest migration, so a brand-new project only ever
needs that one file.

**Multi-tenancy (011/012) is the big structural change here — see its own
section below** for the full reasoning; the short version: every table now
carries a `practice_id`, and RLS scopes every read/write to the signed-in
user's own practice instead of "any authenticated user sees everything."

```sql
-- Practices (multi-tenancy — see "Multi-tenancy" below)
create table practices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table practice_members (
  practice_id uuid not null references practices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (practice_id, user_id)
);

-- Patients
create table patients (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),
  first_name text not null,
  last_name text not null,
  dob date not null,
  sex text check (sex in ('M','F')),  -- only two options offered, per Monika's explicit request — no 'other'
  phone text,
  email text,
  address text,        -- street + house number only — see postal_code/city below for the rest
  postal_code text,
  city text,
  health_card_number text,  -- št. zdravstvene kartice (ZZZS) — captured for future use, not read anywhere in the app yet
  assigned_dentist text,          -- Izbran terapevt — plain editable text, not hardcoded (see "Patient Record page" below)
  internal_record_number text,    -- Št. interne evidence — this practice's own internal patient record number
  diagnoses text[] default '{}',
  created_at timestamptz default now()
);

-- Visits
create table visits (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped from the parent patient row — see "Multi-tenancy" below
  patient_id uuid references patients(id) on delete cascade,
  date date not null,
  notes text,
  created_at timestamptz default now(),
  closed_at timestamptz  -- null = still open (the dentist may still be actively working in it — see "Visit lifecycle" below); set once, never un-set
);

-- Tooth records per visit — ONE ROW PER TOOTH PER VISIT, not one shared row
-- per tooth overall. This is what gives per-tooth chronological history for
-- free (see "Visit lifecycle" below): querying every row for one tooth_id,
-- ordered by the parent visit's date, IS that tooth's treatment history: no
-- separate event-log table needed. While a visit is still open (see
-- visits.closed_at above), the app upserts THIS SAME row on every autosave
-- flush (on the visit_id+tooth_id unique constraint below) rather than
-- inserting a new one per flush; once the visit closes, its rows are never
-- written to again.
create table tooth_records (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped from the parent visit row — see "Multi-tenancy" below
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
  bridge_group_id text,             -- which explicit bridge this tooth belongs to, if any — see "Bridge display" below (bridgeGroupByFdi); not a foreign key, the id itself has no meaning beyond "these rows share the same value"
  notes text,
  created_at timestamptz default now()
);

create unique index if not exists tooth_records_visit_tooth_unique
  on tooth_records (visit_id, tooth_id);  -- enables the upsert-while-open behavior described above

-- Treatment plan entries (schema only — no application code reads/writes
-- this table yet; the invoicing feature will be its first real consumer)
create table treatment_entries (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped from the parent visit row — see "Multi-tenancy" below
  visit_id uuid references visits(id) on delete cascade,
  tooth_id text not null,
  surfaces text[],
  procedure text not null,
  price_eur numeric(8,2),
  status text check (status in ('planned','completed')) default 'planned',
  completed_date date,
  created_at timestamptz default now()
);

-- Terapevti (therapists) — practice-scoped resources for the calendar's Day-
-- view columns. Like `patients`, a therapist has no parent row to derive
-- practice_id from, so the client sets it explicitly on insert (from
-- usePracticeContext()) rather than an auto-stamp trigger. Defined before
-- appointments below since appointments.therapist_id references it
-- (historically added the other way around, via an ALTER TABLE in a later
-- migration — see 013/014_*.sql — but a fresh schema.sql needs the
-- referenced table first).
create table therapists (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),
  name text not null,
  color text not null default '#2e6e62',  -- hex — column header dot + that therapist's appointment-chip color
  created_at timestamptz not null default now()
);
create index therapists_practice_id_idx on therapists(practice_id);

-- Appointments (native scheduling calendar — see "Native scheduling
-- calendar" below). Same pattern as visits/tooth_records/treatment_entries:
-- practice_id is auto-stamped by a BEFORE INSERT/UPDATE trigger copied from
-- set_visit_practice_id(), resolved from patient_id, never sent by client
-- code.
create table appointments (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id),  -- auto-stamped, see trigger below
  patient_id uuid not null references patients(id) on delete cascade,
  therapist_id uuid references therapists(id) on delete set null,  -- nullable — "Neuvrščeno" if unset
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'scheduled'
    check (status in ('scheduled','sent','confirmed','completed','cancelled','no_show')),
  service text,  -- "Predvidena storitev" — free text; no services catalog exists yet
  notes text,
  created_at timestamptz not null default now()
);
create index appointments_practice_id_idx on appointments(practice_id);
create index appointments_patient_id_idx on appointments(patient_id);
create index appointments_therapist_id_idx on appointments(therapist_id);
create index appointments_starts_at_idx on appointments(starts_at);

-- Row Level Security — enable on all tables
alter table practices enable row level security;
alter table practice_members enable row level security;
alter table patients enable row level security;
alter table visits enable row level security;
alter table tooth_records enable row level security;
alter table treatment_entries enable row level security;
alter table appointments enable row level security;
alter table therapists enable row level security;

-- Policy: each practice can only see/write its own rows — see
-- "Multi-tenancy" below for current_practice_id() and the full reasoning.
-- Split into 4 explicit per-operation policies per table (select/insert/
-- update/delete), not one "for all", so a future tightening of one
-- operation can never silently affect the other three. Shown once for
-- patients; visits/tooth_records/treatment_entries repeat the identical
-- shape, keyed on that table's own practice_id column.
create policy patients_select on patients for select
  using (practice_id = current_practice_id());
create policy patients_insert on patients for insert
  with check (practice_id = current_practice_id());
create policy patients_update on patients for update
  using (practice_id = current_practice_id())
  with check (practice_id = current_practice_id());
create policy patients_delete on patients for delete
  using (practice_id = current_practice_id());
-- [visits_*, tooth_records_*, treatment_entries_*, appointments_*,
--  therapists_* — identical shape, keyed on that table's own practice_id
--  column — see supabase/schema.sql / migrations/012_replace_rls_policies.sql
--  and 013_add_appointments.sql/014_add_therapists.sql]
```

---

## Multi-tenancy

**Status: built and confirmed live (2026-09-15).** The app was built for
exactly one dental practice (Monika's) — every table had RLS "enabled" but
every policy was `auth.role() = 'authenticated'`, meaning any signed-in
user could read/write every practice's data. That was fine with one real
login; it stopped being fine the moment Gregor's actual goal — a CRM +
charting + invoicing product sold to multiple dental practices — became
explicit. This is medical PII, so tenant isolation had to be correct before
any CRM/invoicing feature gets built on top of it.

**Design: flat `practice_id` on every table, not join-based RLS.** The
naturally-tempting alternative — `practice_id` only on `patients`, with
`visits`/`tooth_records`/`treatment_entries` scoped via nested subqueries
through their existing foreign keys — was considered and rejected: each
nested subquery would re-evaluate the referenced table's *own* RLS policy,
so `tooth_records` (upserted on every 30s autosave — the hottest table)
would re-evaluate `visits`' RLS, which re-evaluates `patients`' RLS, on
every read/write. It's also harder to audit at a glance, which matters for
medical data. Instead, every table gets its own flat, indexed `practice_id`
column — but application code never sets it on the three child tables:

- **`patients.practice_id`** is the one column application code sets
  explicitly — `usePatients.ts`'s `createPatient()` stamps it from
  `usePracticeContext()` (the only top-level insert with no parent row to
  inherit a practice from).
- **`visits`/`tooth_records`/`treatment_entries`** each have a
  `BEFORE INSERT/UPDATE` trigger (`set_visit_practice_id()`,
  `set_tooth_record_practice_id()`, `set_treatment_entry_practice_id()`)
  that copies `practice_id` down from the parent row (`visits` from its
  `patients` row, the other two from their `visits` row) — **zero code
  changes were needed in `useOpenVisit.ts`/`useVisit.ts`**, neither of
  which has ever sent a `practice_id`. A real security bonus falls out of
  this too: since the trigger *overwrites* whatever `practice_id` a client
  sends, a buggy or malicious client can't smuggle a row into another
  practice by attaching a fabricated `practice_id`.
- **`current_practice_id()`** is a `SECURITY DEFINER`,
  `search_path`-pinned SQL function reading a new `practice_members` join
  table (`user_id` → `practice_id`) — the standard Supabase-recommended
  pattern for RLS helper functions, avoiding the cross-table RLS
  re-evaluation problem above. Every policy is a single flat
  `practice_id = current_practice_id()` check — fast, and auditable at a
  glance.

**Signup: a `SECURITY DEFINER` trigger on `auth.users`, not client-side
inserts.** `handle_new_user_practice()` fires `AFTER INSERT ON auth.users`
and atomically creates a new `practices` row (named from
`raw_user_meta_data->>'practice_name'`, defaulting to "New practice" if
absent) plus a `practice_members` row linking the new user as owner. This
fires regardless of whether Supabase's email-confirmation setting is on or
off, and regardless of whether the account was created via a future
self-serve signup form or (today's actual path) the Supabase dashboard's
"Add user" — a new login can never end up with no practice.

**No self-serve signup page exists yet — deliberate, per Gregor's explicit
answer.** A live medical-records app with zero-vetting open registration is
a product decision to make on purpose later (invite codes? billing gate?
manual approval?), not a side effect of this migration. New practices are
created manually via Supabase Dashboard → Authentication → Add user for
now, which still exercises the same trigger.

**Footguns, deliberately held to:**
- Every `SECURITY DEFINER` function pins `set search_path = public,
  pg_temp` — closes the classic search-path-hijack privilege-escalation
  vector. Don't drop this if any of this SQL gets hand-edited.
- **Never add a self-service INSERT policy on `practice_members`.** A naive
  `with check (user_id = auth.uid())` would let any authenticated user add
  themselves to *any* `practice_id` they can guess — instant full access to
  that practice's entire patient database. All provisioning goes through
  the trigger; leave it that way until a real, validated invite flow
  exists (not built yet — `practice_members`' composite PK and `role`
  column already support a user belonging to >1 practice / being "staff"
  rather than "owner," but nothing in the UI uses either yet).
- `practices`/child-table foreign keys have no `on delete cascade` —
  deleting a practice while patients reference it fails loudly instead of
  silently cascading into patient-record deletion. Deliberate.

**Backfill note**: the one pre-existing practice ("Monikina ordinacija")
links both real accounts as owners — `goslar.monika@gmail.com` and
`gregor.goslar@gmail.com` — so backfilling only one wouldn't silently lock
the other out.

**Verified live**: `scripts/verify-tenant-isolation.mjs` (throwaway, not
shipped as part of the app) scripts the actual security property against
the live project — a second practice's account sees zero patients, can't
read or write a specific patient/visit id belonging to the first practice,
and the first practice can't see what the second one creates. All 7
assertions passed against Monika's real account + one throwaway test
account created via the dashboard. A manual pass on `localhost:5181`,
signed in as each account in turn, confirmed the same thing visually — see
`AppNavShell`'s "Uporabnik: <practice name>" label, now sourced from
`usePracticeContext()` instead of a hardcoded `'Monika Goslar'`.

**Explicitly not part of this pass** (flagged, not forgotten): a self-serve
`Signup.tsx` page, staff-invite UI for `practice_members`, practice
branding/settings beyond a plain name, billing/subscriptions, and any
actual CRM/invoicing feature work — this was purely the tenancy foundation
those sit on.

---

## Dental Chart — Visual Specification

### Tooth numbering (FDI — same as EL 81 paper form)
```
Upper:  18  17  16  15  14  13  12  11  |  21  22  23  24  25  26  27  28
Lower:  48  47  46  45  44  43  42  41  |  31  32  33  34  35  36  37  38
```
Direction: **always left→right as displayed** (zobozdravnikov pogled, ne pacientov).

### Tooth types
- **Anteriorna** (sekalci + podočniki): 11,12,13 / 21,22,23 / 31,32,33 / 41,42,43
  - **4 ploskve**: labialna (b), lingvalna (l), mezialna (m), distalna (d)
  - NO okluzalna surface
- **Posteriorna** (premolarji + molarji): vse ostale
  - **5 ploskev**: bukalna (b), okluzalna (o), lingvalna (l), mezialna (m), distalna (d)

### Tlorisni pogled (top-down, FDI square template)
Each tooth = 28×28px SVG square divided into surfaces, geometry pixel-measured
from `dental chart template.jpg` and finalized in [`design/tooth-chart-prototype/`](design/tooth-chart-prototype/):
- **Line convention — applies to anything added to this view later, not just
  what's already here:** every line is `#1f1e20` and `1px`
  (`BORDER`/`LINE_WIDTH` in `ToothTopView.tsx`) — the outer square/circle
  border, every internal divider (triangle edges, occlusal-rectangle
  border, anterior mid-line), and every status's x-cross alike. This is a
  hard-won consistency, not an accident: `extracted`/`missing`/`implant`
  each used to have their own distinct outline color (red, grey, purple)
  and the x-crosses were each sized off their own status's bounding box
  (so different statuses' crosses came out different thicknesses even
  after their colors were unified) — both reverted per Monika's explicit
  requests, in that order (color first, then width). **When adding a new
  status, symbol, or region to this view, reuse `BORDER`/`LINE_WIDTH`
  rather than introducing a new color or a bounding-box-relative stroke
  width** — that box-relative default is exactly the inconsistency this
  history undid. Three deliberate exceptions carry their own color *and*
  their own thicker `3px` stroke instead of `#1f1e20`/`1px` — "the line
  convention" is a default, not an absolute: `abrasion`'s own red
  (`#9D1616`) mark, so it stands out as a distinct kind of mark, not a
  line — see the `abrasion` exception below; the endo-circle symbol (drawn
  off `endoStage`, an independent field — not a `ToothStatus` — see "Canal
  display" below), blue/red/grey depending on stage, at the same `3px`
  weight; and the `extraction_planned`/`extracted` X-cross, same `3px`
  weight and the same red/blue as the endo-circle (see
  "Absent tooth: missing / extraction / extracted" below) — all three are
  **status markers**, not structural lines, which is exactly why they're
  allowed to break the convention everything else here follows.
  `StatusLegend.tsx`'s own swatches are a separate, smaller, fixed-scale
  icon grid, not part of this convention (its crosses stay `0.98px`,
  unaffected).
- Posteriorna: 4 outer triangles + a center rectangle (okluzalna), rectangle
  `10×8` centered in the square (i.e. `x=9,y=10` on the 28×28 grid) — closer
  to a square than the box the triangles form, per reference image
- Anteriorna: 4 triangles meeting at a short horizontal collapsed line (the
  same `10`-wide span at mid-height) rather than a single point — this
  matches the reference image, where the two mesial/distal triangles are
  visibly taller than a true point-meet would produce
- Each triangle/surface filled with status color; no background fill for
  `healthy` (transparent, not grey — grey read as "filled with a status" in
  review)
- **Exception — `caries`/`caries_treated` mark a surface with a dot, not a
  fill**, per Monika's explicit request. Both set `fill: 'none'`
  (`statusStyles.ts` — `caries` was previously a flat coral, `#F0997B`,
  whole-region fill), and `ToothTopView.tsx` instead draws a small filled
  circle — 3px across (`CARIES_DOT_RADIUS = 1.5`, a *filled* marker with
  its own fixed size, deliberately not tied to `LINE_WIDTH`, since it's
  not a stroked line) — at the center of every individual zone (each
  triangle, or the posterior occlusal rectangle) whose own resolved status
  is `caries` or `caries_treated`, via `cariesDotColor()`. **This is the
  one status pair in this file that's genuinely per-surface, not
  whole-tooth-only** — every other symbol (`x-cross`, `endo-circle`, etc.)
  only ever fires off `surfaces.all`; caries dots are checked per zone
  (`statusFor(surfaces, zones[zone])`, the same per-surface lookup the
  ordinary fill path already used), so a tooth can show different dots on
  different surfaces at once, or (via `surfaces.all`) a dot on *every*
  surface if the whole tooth is set at once. "The center of the surface"
  is computed with a small `centroid()` helper (plain vertex average of
  that zone's own `zonePolygons` entry, or `BAND_X + BAND_W/2`/
  `BAND_Y + BAND_H/2` for the occlusal rectangle) — not a hand-placed
  guess per zone shape, so it stays correct if the zone geometry ever
  changes. **Anterior teeth's mesial/distal ("side" — `left`/`right`)
  zones' dots are nudged ~2 units further inward than their plain
  centroid** — `dotPositionFor()` wraps `centroid()` and, for anterior
  teeth's `left`/`right` zones specifically, shifts the point toward
  `(14,14)` (the tooth's own center — the same point every
  corner-to-corner symbol in this file, like the endo-circle, is centered
  on). Anterior side zones are true triangles (two of the three vertices
  on the tooth's own outer corner, one inner apex), so their plain
  centroid skews hard toward that outer edge — close enough to collide
  with the endo-circle, which also reaches those same outer edges whenever
  `endoStage` is set. Monika caught this on tooth 33 ("these
  dots are attached to the red circle and thus a bit poorly visible") —
  the first fix applied the shift to *every* tooth's side zones, which
  she then flagged as wrong for posterior teeth (4–8, e.g. molars):
  their own side zones are trapezoids (two inner + two outer vertices),
  whose centroid already lands clear of the circle without any shift, so
  applying one there was an unnecessary (if harmless-looking) change to
  teeth that were "completely fine as they were before" — caught only
  because the fix was checked live on localhost rather than trusted from
  centroid math alone (see the workflow note under "Coding Conventions"
  below). `top`/`bottom` zones don't have the overlap problem on either
  tooth type (their own centroid already sits well clear of the circle)
  so they're left at the plain centroid regardless of tooth type.
  **Colors**: red (`#E94949`, `TODO_COLOR`) while a surface still needs
  treatment, blue (`#1412A9`, `DONE_COLOR`) once it's been treated — the
  same two colors the endo-circle and `extraction_planned`/
  `extracted` also use for their own red/blue markers (see "Canal display"
  and "Absent tooth: missing / extraction / extracted" below). This used
  to be a *dedicated* red/blue per feature — caries, endo, and (once it
  existed) extraction each had their own slightly different hex, on the
  reasoning that each was "a distinct clinical marker, not the same one
  repainted." Monika's explicit request reverted that: red should always
  mean "still needs doing" and blue always "done," the same two colors
  everywhere on the chart, so urgency/completion reads at a glance without
  having to remember which shade belongs to which feature. Both constants
  live in `statusStyles.ts` (exported alongside `STATUS_STYLES`, not
  folded into it — `StatusStyle`'s `border`/`fill`/`symbol`/`symbolColor`
  fields are all whole-tooth concepts and don't fit a per-surface marker)
  so every file that draws a todo/done marker (`ToothTopView.tsx`,
  `ToothSideView.tsx`, `StatusLegend.tsx`) shares one source rather than
  duplicating the literals — the legend shows one representative dot
  centered in its swatch square, since it has no per-surface zones of its
  own to place multiple dots in.
  **A third color, grey (`#8a8f94`, `STATUS_COLOR`), was added later** for
  a third state alongside "to be done"/"done": a *pre-existing/historical*
  finding — something already true about the tooth before this practice
  started tracking it (a crown or root canal done elsewhere years ago,
  say), distinct from something newly planned or newly completed here.
  Per Monika's explicit request, this reuses the exact grey `BridgeRow.tsx`
  already used for the bridge bracket and fissure-sealant tilde, rather
  than a fresh color, since that grey already read as "neutral/status" on
  this chart. Applied to the endo-circle's own `existing` stage (see
  "Canal display" below),
  `overlay_existing` (see "Bridge display" below), `sealant_existing`
  (see "Bridge display" below), and — after an initial round where it was
  deliberately left out — `filling` too. The first pass reasoned that an
  "existing caries" state doesn't map onto real clinical practice the way
  an existing root canal or overlay does (active decay either needs
  treatment or has been treated), and that `filling`'s *own* flat white
  fill already played the "pre-existing restoration" role for that family,
  making a third grey caries-dot state redundant with it. Monika's later
  explicit follow-up reversed that: `filling`'s flat fill wasn't actually
  consistent with how the rest of the caries family reads (a patient can
  arrive with several existing amalgam fillings, and those need marking
  the same per-surface-dot way caries/caries_treated already are, not a
  different flat-fill mechanism) — so `filling` itself was converted from
  a flat `#FFFFFF` whole-surface fill to a grey dot via `cariesDotColor()`
  (`ToothTopView.tsx`), joining `caries`/`caries_treated` in the same
  per-surface mechanism, relabeled "Plomba (obstoječa)" to distinguish it
  from `caries_treated`'s own now-simpler "Plomba" label (see the
  `caries`/`caries_treated`/`filling` row notes in the color table above).
  `ToothSideView.tsx`'s `isCariesStatus` white-crown fix (see
  "Healthy-tooth coloring" below) had to grow to cover `filling` too, for
  the exact same reason it already covered `caries`/`caries_treated` —
  once `filling`'s fill became `'none'` instead of an opaque white, it fell
  into the same "whole tooth reads solid grey" trap without that fix.
- Widths were unified to the `1px` in the line convention above from a
  previously uneven set: internal dividers were `0.75px` ("thinner than
  the outer border, per feedback" — an earlier, since-reverted rationale),
  and each status's x-cross was sized off its own bounding box
  (`Math.max(width, height) * 0.07`, `StatusSymbol.tsx`'s own default
  formula), so `extracted`/`missing` (1.54px) and
  `prosthesis`/`bridge_pontic` (1.12px, already hand-matched to each
  other — see the `prosthesis` exception below) came out different
  weights despite eventually sharing one color. Every `StatusSymbol` call
  in `ToothTopView.tsx` now passes `strokeWidth={LINE_WIDTH}` explicitly
  instead of leaving it to that box-relative default — bounding-box
  *position/size* still differs per status (e.g. prosthesis's smaller box
  to stay inside its circle), only the stroke weight itself is fixed now.
- **Exception — `abrasion` (tooth wear) never fills a surface region.**
  Unlike every other status, it doesn't tint any triangle/band at all —
  it's drawn as its own dedicated red (`#9D1616` — darkened from an
  earlier `#D4537E` per Monika's explicit request) mark on top of
  everything else, per Monika's feedback that a full color-coded fill
  wasn't needed here, just the line itself recolored:
  - Anterior teeth (1–3), which have no occlusal surface: the collapsed
    mid-line standing in for the incisal edge is simply redrawn **red and
    thicker** (`3px` vs. the normal `1px` every other line in this view
    uses) instead of the usual dark divider color.
  - Posterior teeth (4–8): the center occlusal rectangle's own border is
    redrawn **red and thicker** the same way (`3px`), with the rectangle itself
    left unfilled — a hollow red box, not a solid fill.

  Every other region (the four outer zones on both tooth types, plus the
  posterior occlusal rectangle's fill) stays fully transparent whenever its
  resolved status is `abrasion` — implemented in `ToothTopView.tsx` via
  `regionFillFor()`. The whole-tooth outer border also stays the normal
  dark color for `abrasion` (unlike `extracted`/`missing`), since
  `STATUS_STYLES.abrasion` intentionally has no `border` override.
  **Applying `abrasion` by clicking an individual surface (not the whole
  tooth) redirects to the whole-tooth path** — since this mark reads off
  `wholeToothStatus`/the resolved occlusal surface only (never any other
  individual zone), a per-surface click used to have no visible effect at
  all for most surfaces. See `redirectsSurfaceEditToWholeTooth()` under
  "Interaction Design" → "Click on tooth" for the fix and the fuller
  reasoning.
- **Exception — `bridge_pontic` skips surface subdivisions entirely.** A
  bridge tooth is one prosthetic unit, not a natural tooth with its own
  per-surface findings, so — per Monika's feedback — it doesn't need
  caries/filling-style per-surface tracking at all: no triangles, no
  occlusal rectangle, no internal divider lines. It renders as a single
  flat square instead. Implemented in `ToothTopView.tsx` via
  `isBridgeMember`, which just skips the zone-fill/divider JSX blocks.
  **There's no separate `bridge_anchor` status anymore** — per Monika's
  explicit request ("this is prevleka where bridge is fixed on"), a bridge
  anchor tooth is just a plain `crown`, structurally and visually
  identical to any other crowned tooth; `isBridgeMember` used to check for
  `bridge_anchor` too, rendering it as a solid filled teal square via this
  same exception, but `crown` already gets that exact flat-square
  treatment through the *next* exception below (`FLAT_INNER_STATUSES`), so
  `isBridgeMember` was simplified to check `bridge_pontic` alone —
  `bridge_pontic` (`STATUS_STYLES.bridge_pontic.fill = 'none'`, so it
  contributes no flat color of its own) instead gets a plain **X-cross**
  (`STATUS_STYLES.bridge_pontic.symbol = 'x-cross'`) over an empty square
  with a **solid** (not dashed) border. This has gone through several
  looks against Monika's own feedback each time: a solid darker-teal
  fill, then a dense diagonal cross-hatch `<pattern>`, then a dashed
  outline with a red (then grey) cross — all reverted, most recently in
  favor of a plain X, solid outline, **same dark color as every other
  tooth's own outline** — Monika's explicit ask, after the grey version,
  was for the cross to match the rest of the chart rather than stand out
  in its own color. That still needed a new `StatusStyle.symbolColor`
  field (`statusStyles.ts`): the square's own `border` is unset (so its
  outline falls through to the default dark tooth-outline color already),
  and without `symbolColor`, the cross would fall through to a *different*
  per-file fallback instead — `ToothTopView.tsx` and `StatusLegend.tsx`
  each had their own leftover default-when-nothing-set color, never
  actually exercised before (every prior x-cross status set an explicit
  `border`), so `bridge_pontic` was the first to expose that the two
  fallbacks disagreed. `symbolColor: '#1f1e20'` pins the cross to the same
  literal color the square's own default outline resolves to, rather than
  relying on either fallback. Both files now read the glyph's color as
  `symbolColor ?? border ?? <fallback>`, so every other status (which
  never sets `symbolColor`) falls straight through to its old
  border-based behavior, unchanged.
  **Size is also special-cased**: the cross's arms reach the square's own
  corners exactly (`x=1,y=1,width=26,height=26`, matching the outer
  `<rect>`'s own coordinates), not the generic inset box every other
  x-cross status uses. This needed a new `StatusSymbol` prop,
  `strokeWidth` (`ui/StatusSymbol.tsx`), to decouple the stroke's weight
  from that bounding box — previously the stroke was always derived from
  the box itself (`Math.max(width, height) * 0.07`), so a naive
  corner-to-corner box would have read visibly thicker just from being a
  bigger box, with no way to override that. Originally this override
  pinned pontic's cross to *prosthesis's own* weight specifically
  (`PONTIC_X_STROKE_WIDTH`, matching that `* 0.07` formula applied to
  prosthesis's smaller box) — since superseded by a flat `LINE_WIDTH = 1`
  applied to every status's cross uniformly, once Monika asked for all of
  the tloris view's lines (border, dividers, crosses alike) to share one
  width — see the `1px` unification note under "Tlorisni pogled" above.
  The `strokeWidth` override mechanism this introduced is what made that
  later, broader unification possible without more rework.
- **Exception — `crown`/`implant`/`missing`/`extracted`/`prosthesis_crown`
  also skip surface subdivisions, per Monika's explicit follow-up request
  to remove their inner divider lines.** These five join `bridge_pontic`
  in `ToothTopView.tsx`'s `skipSubdivision` flag (`FLAT_INNER_STATUSES`,
  checked via `isFlatInner`) — no triangles, no occlusal rectangle, no
  divider lines, same as bridge members already had. `crown` being on this
  list is also what a bridge *anchor* tooth relies on now that
  `bridge_anchor` isn't its own status — see the `bridge_pontic` exception
  above. The outer square's own fill — previously only extended to bridge
  members (`isBridgeMember ? fillFor(...) : 'none'`) — now covers this set
  too (`isBridgeMember || isFlatInner`), so `crown`/`implant`/
  `prosthesis_crown`/`missing`/`extracted` all gain a solid whole-square
  fill in place of the four individually-filled triangles + occlusal
  rectangle they used to render. `missing`/`extracted` fill with
  `ABSENT_SILHOUETTE_COLOR` specifically (a light near-white, not
  transparent) rather than a "real" status color — see the dedicated
  "Absent tooth: missing / extraction / extracted" section below for their
  full current treatment, which has changed substantially since this
  paragraph was first written (no more dashed border, and the two statuses
  now diverge on the X-cross rather than sharing one). This is
  **whole-tooth only** (`surfaces.all`), the
  same simplification every other flat/symbol-driven status in this view
  already makes — a tooth with e.g. `{ m: 'crown' }` set on just one
  surface (not `all`) still renders that surface's own triangle
  individually, unaffected by this exception. (`StatusShowcase.tsx` used
  to carry a dedicated per-surface demo grid, `SURFACE_TESTS`, exercising
  cases like this one — removed per Monika's explicit request, "it does
  not have any logic," since the grid was really just spot-checking
  surface/zone mapping rather than demonstrating any status behavior.)
  **`FLAT_INNER_STATUSES` is a living list, not a one-time fix — add any
  future status here too if it's meant to render as a flat, undivided
  square** (whether newly designed that way, or meant to visually match
  an existing entry, the way `prosthesis_crown` was added specifically to
  keep matching `crown` once `crown` itself went flat). Forgetting to add
  a new status here is exactly how two statuses meant to look identical
  quietly drift apart, which is what happened before `prosthesis_crown`
  was caught and fixed.
- **Exception — `prosthesis` (removable-denture tooth) swaps the outer
  square for a circle, tloris view only.** Per Monika's explicit request:
  a tooth replaced by a removable denture isn't a natural tooth and isn't
  "extracted" or "missing" either — it needed its own shape so it reads as
  a distinct case at a glance (see "Absent tooth: missing / extraction /
  extracted" below for how those two look today — both have moved on from
  the dashed-square look this paragraph originally compared `prosthesis`
  against). Like a bridge member, it also skips per-surface subdivision
  entirely (no triangles, no occlusal rectangle, no divider lines) —
  implemented in `ToothTopView.tsx` via `isProsthesis`, folded into the
  same `skipSubdivision` flag that already gated `isBridgeMember`. The
  outer element itself becomes a `<circle>` (`cx=14,cy=14,r=13`, the same
  bounding box the square occupied) instead of the usual `<rect>`,
  unfilled, with a **solid** (not dashed) border — the circle shape alone
  is the distinguishing signal here, so a dashed outline on top would be
  redundant. `STATUS_STYLES.prosthesis` sets `symbol: 'x-cross'`, drawn by
  the same generic `wholeStyle.symbol` rendering block at the bottom of
  `ToothTopView.tsx` — but that block's default bounding box
  (`x=3,y=3,w=22,h=22`) is sized to fit inside the 26×26 **square**; its
  corners sit past the circle's own radius (13), so the cross's arms would
  poke outside the circle's outline. Fixed with a smaller,
  `isProsthesis`-only bounding box (`x=6,y=6,w=16,h=16`, corners at radius
  ~11.3 — safely inside), the one piece of the symbol rendering that *is*
  circle-specific. Color: the same dark `#1f1e20` every ordinary tooth's
  own outline/divider lines use — an earlier grey (`#8a9490`, matching
  what `missing` used to use) was reverted per Monika's feedback that the
  circle should read as a normal tooth outline color, not stand out. The
  X-cross glyph shares this color automatically, since both read it off
  `wholeStyle.border`. `StatusLegend.tsx` mirrors the same circle swap for
  its `prosthesis`
  swatch (`isProsthesis`, alongside the existing `isPontic` special-case)
  so the legend matches what's on the chart.
  **Adjacent `prosthesis` teeth are linked with a connecting line**, per a
  reference image Monika shared (three X-crossed circles joined by a
  straight bar) — echoing a real denture's own connecting bar joining
  multiple replaced teeth into one prosthetic unit. Implemented in
  `TlorisRow.tsx` (not `ToothTopView.tsx` — a single tooth's own SVG has no
  way to reach into its neighbor's), via `findProsthesisGapIndices()`,
  which scans that quadrant's own `fdis` for adjacent pairs that both pass
  `isProsthesisLink()` (see below). Rendered as short `<line>` segments in
  an absolutely positioned `<svg>` overlay (so it doesn't disturb the row's own flex
  layout), one per connected gap — never one continuous line across an
  entire run — each spanning *only* the gap between two adjacent teeth's
  own column edges (computed from `COLUMN_WIDTH`/`COLUMN_GAP` and the
  fixed 26px tooth size, the same margin math `BridgeRow` already uses for
  its own bracket positions), stopping exactly at each tooth's own
  boundary rather than running under its artwork. This matters for
  `prosthesis` specifically because its circle has a transparent
  (`fill: 'none'`) interior — a single line spanning a whole run's full
  width would show straight through every circle's middle, crossing the
  X-cross glyph, which the reference image does not show; it also means
  the same geometry works unmodified once `prosthesis_crown` (a solid
  square, not a circle) joins the same run — see below. Same connector
  color as the circle/cross itself (`#1f1e20`).
  **A natural crowned tooth can anchor the same prosthesis too** —
  `prosthesis_crown`, per Monika's explicit request (demoed on tooth 42,
  chained to 41's `prosthesis`). Renders as a completely ordinary `crown`
  tooth (`STATUS_STYLES.prosthesis_crown` is just `{ fill: '#9FE1CB' }` —
  no border override, no symbol) — including `crown`'s own flat,
  no-subdivision rendering (`FLAT_INNER_STATUSES` in `ToothTopView.tsx`,
  see the exception under "Tlorisni pogled" above — `prosthesis_crown` is
  included there specifically so it keeps matching `crown` now that
  `crown` itself is flat too) — but still joins the same
  connector line: `findProsthesisGapIndices()` and the `showPrevHalf`/
  `showNextHalf` cross-midline checks all went from a hardcoded
  `=== 'prosthesis'` comparison to a shared `isProsthesisLink(status)`
  helper (`TlorisRow.tsx`, exported for `ArchRow.tsx`'s own midline check
  to reuse) that accepts either status — the two are visually distinct
  (circle+X vs. an ordinary crown) but functionally identical for
  connector purposes, and no geometry change was needed (see the
  column-edge-not-circle-edge point above). This is deliberately a different mechanism
  from a bridge anchor's `BridgeRow` bracket, even though both connect a
  crowned tooth to something else visually — `prosthesis_crown` belongs to
  a *removable* prosthesis (a straight through-line, no ticks, following
  `TlorisRow`'s own connector), while a bridge anchor (a plain `crown`
  tooth — see "Bridge display" below) belongs to a *fixed* bridge (a
  bracket with ticks dropping onto the tloris row, via `BridgeRow`).
  Picking the wrong one would
  draw the wrong shape connecting the wrong teeth, so don't conflate them.
  **The connector also crosses the arch's own midline** (e.g. tooth 41 in
  the lower-left quadrant linked to 31 in the lower-right quadrant), per
  Monika's explicit request — this needed more than `TlorisRow.tsx` alone,
  since the two quadrants are genuinely separate component instances
  (`QuadrantBlock`s either side of `ArchRow`'s own divider), so a single
  quadrant's own SVG can't reach across into its sibling's. `ArchRow.tsx`
  checks the two boundary teeth itself (`crossesMidline`, last FDI of
  `leftQuadrant` vs. first FDI of `rightQuadrant`) and passes
  `connectToNext`/`connectToPrev` down to the two `TlorisRow`s on either
  side; each draws its own **half** of the connector — a short segment
  from its own boundary tooth reaching `HALF_GAP` (half of `COLUMN_GAP`)
  out past its own row's edge — via `overflow: visible` on that row's SVG,
  so the line can bleed past the row's own `[0, totalWidth]` box without
  changing that box's actual layout size. The two halves meet exactly at
  the shared gap's midpoint because both quadrants are always the same
  width (8 teeth each) and that gap is now exactly `COLUMN_GAP` — see the
  gap-equalization change directly below, which this depends on: before
  that change the midline gap was wider than `COLUMN_GAP`, so a single
  `HALF_GAP` reach from each side wouldn't have met in the middle.
  **The gap between quadrants (11↔21, 41↔31, etc.) is now exactly
  `COLUMN_GAP`**, the same as every ordinary tooth-to-tooth gap, per
  Monika's explicit feedback that it originally read as noticeably wider.
  The previous version rendered the divider as a third flex child between
  the two `QuadrantBlock`s, so it consumed a `COLUMN_GAP` flex gap on
  *both* sides of itself, plus its own `mx-1.5` margins on top of that —
  a `COLUMN_GAP` + divider-width + `COLUMN_GAP` (plus the removed margins)
  footprint far wider than one plain `COLUMN_GAP`. `ArchRow.tsx` now lays
  out just the two `QuadrantBlock`s with a single `COLUMN_GAP` flex gap
  between them (matching any other tooth pair exactly), and renders the
  divider as an absolutely positioned bar. Its horizontal position
  (`dividerLeftPx`) is computed as an **explicit pixel offset** —
  `leftQuadrant.length * COLUMN_WIDTH + (leftQuadrant.length - 1) * COLUMN_GAP + COLUMN_GAP / 2`,
  the exact same "quadrant width, then half
  the shared gap" formula `TlorisRow`'s own `HALF_GAP` connector uses for
  this identical boundary — deliberately *not* CSS percentage centering
  (`left-1/2`), which was tried first on the assumption that both
  quadrants are always equal width so the row's own horizontal center
  should coincide with the gap's midpoint. That assumption didn't hold in
  practice — the divider ended up positioned inside the right quadrant
  (around tooth 27 on the upper arch, 37 on the lower), well off the true
  midline, for reasons not fully pinned down (some sibling row not sizing
  to exactly `leftWidth + gap + rightWidth` seems likeliest). The pixel
  formula sidesteps the question entirely by not depending on the row's
  own measured width at all.
  **Stranski pogled (side view) treats it differently than the tloris
  view**: no circle equivalent there (side-view teeth were never square to
  begin with) and, per Monika's explicit feedback, **no x-cross either** —
  a crossed-out side-view tooth reads as "extracted/missing," which isn't
  what a denture replacement is. `ToothSideView.tsx` gives `prosthesis`
  the "no root" treatment folded into the shared `hidesRoot` flag
  (`isImplant || isPontic || isProsthesis`), which clips the traced root's
  fill and ink-detail layers to the crown zone only, so nothing
  root-shaped shows through. **The crown is hidden too**
  (`hidesCrown = isPontic || isProsthesis`) — an earlier version kept the
  crown shown, on the reasoning that a denture tooth "still has a crown, just no root,"
  but Monika asked for that removed in a follow-up request, so
  `prosthesis` now matches `bridge_pontic` exactly here: nothing of the
  traced photo is drawn, crown or root, for either status. Neither has a
  dashed outline left to fall back on either — `bridge_pontic`'s was
  removed in an earlier request, and `prosthesis` never had one
  (`STATUS_STYLES.prosthesis` has no `borderDash`) — so both simply render
  blank in the side view, with only their column position marking where
  they sit. The generic `style.symbol === 'x-cross'` block that draws the
  cross is given an explicit `&& !isProsthesis && !isPontic` exclusion —
  with the crown gone too, a lone X would just read as a stray mark
  floating in empty space. The dashed-outline clip was generalized to the
  shared `hidesRoot` flag (rather than being `isPontic`-only, as an
  earlier version had it) so any hides-root status with a dashed border is
  covered automatically.

### Stranski pogled (anatomic side profile)

**Status: sourced and finalized.** Monika provided her own reference photo
for each of the 32 adult teeth (one JPG per tooth). These were traced —
not hand-drawn, not adapted from a generic library — into SVG path data
using a Node.js pipeline (`pngjs` + `jimp` + `potrace`). The working
generator, its source data, and a static HTML preview are checked into the
repo at [`design/tooth-chart-prototype/`](design/tooth-chart-prototype/):

- `traced-teeth.json` — per-FDI trace output: `{ "<fdi>": { d, detailD, width, height } }`
- `generate-chart.js` — reads that JSON and renders the full 32-tooth chart as static HTML (`node generate-chart.js` → `chart-preview.html`)
- `chart-preview.html` — the last-generated output, for visual reference

Two paths are traced per tooth, not one, because a single filled-silhouette
trace loses internal line detail:
- **`d`** — the outer silhouette, flood-filled and traced. Used as a
  clip path (crown vs. root color split at the gumline) and to clip the
  whole tooth render so stray marks outside the tooth's own outline never
  show.
- **`detailD`** — a raw ink-mask trace (no flood fill) of the same photo,
  preserving internal pen strokes: root division lines, fissures, crown
  contours. Rendered as a single unstroked fill on top of the crown/root
  color fill — this is what reads as the tooth's "line art." Rendering
  detail as a separate top layer (rather than stroking the silhouette
  itself) avoids doubled/overlapping strokes at the gumline clip boundary.

Other finalized rules:
- Crown vs. root split: no separate gingiva stroke is drawn. The gumline
  (CEJ) is a Y-coordinate computed from **real anatomical data**
  (`toothAnatomy.ts`): `crownFraction = crownLengthMm / (crownLengthMm + rootLengthMm)`,
  applied to the tooth's own traced-photo pixel height — not a hand-picked
  guess per tooth type.
- **Healthy-tooth coloring**: the whole silhouette fills `#D8D5CC` (`ROOT_COLOR`
  in `ToothSideView.tsx`) first, standing in for the root; the crown region
  is then painted white (`#FFFFFF`) on top when the tooth's status is
  `healthy` or unset — a deliberate white/grey split, not the flat
  single-tone fill used before. `extracted`/`missing` used to leave the
  crown fill as `'none'` too (so a dashed border/symbol read against the
  `#D8D5CC` root color showing through underneath) but no longer do (see
  "Absent tooth: missing / extraction / extracted" below for their
  current, quite different treatment) — `root_only` was the one other
  status built the same see-through-grey way, since removed entirely (see
  the "Status cleanup pass" note in "Current Status & Next Steps" below),
  so no status currently relies on that bare fallback on purpose; the
  underlying `'none'` fallback in `crownFill`'s own ternary is still there
  for whatever status might need it next.
  **`extraction_planned`,
  `overlay_planned`/`overlay`/`overlay_existing`, and `caries`/
  `caries_treated`/`filling` all get the same white treatment as
  `healthy`** instead of falling through to that bare fallback. Each of these fills
  `'none'` in `statusStyles.ts` and has no symbol of its own in the side
  view (their markers — overlay's cap, extraction's X,
  caries/filling's dot — are drawn elsewhere: the tloris square,
  `BridgeRow`'s own row, or not at all in this view), so without this
  exception the crown falls through to fully transparent, and with
  nothing painted over the root-grey base layer underneath, the *whole*
  tooth (crown included) reads as solid grey instead of the normal
  grey-root/white-crown split. This is exactly the bug Monika caught on
  tooth 36 back when endo was still a `ToothStatus` (`endo` — "why is the
  whole tooth `#D8D5CC`, we don't have that color for crowns") — none of
  these statuses change a tooth's
  outward appearance, so a plain white crown (the same as any other
  present, unremarkable tooth) is correct for all of them. The list has
  grown by re-discovery, not by design: each new status added to this
  exception was caught only once someone actually looked at that specific
  status *alone*, with no other status also fixing the crown incidentally.
  `caries`/`caries_treated` were one such instance — every earlier demo of
  either happened to sit on a tooth that also had `endo`/`endo_planned`
  set (teeth 33/36, back when those were still `ToothStatus` values),
  which already fixed the crown, so the gap stayed
  invisible until tooth 16 (plain `{ all: 'caries' }`, no endo involved)
  exposed it. (Endo itself no longer needs an entry in this list at all —
  now that it's an independent field, `EndoStage` values never reach the
  `status` prop this logic runs on in the first place, so it can't trip
  this trap anymore; see "Canal display" above.) `filling` joined the list later still, once it switched from
  its own flat opaque `#FFFFFF` fill (which never had this bug, by
  coincidence — an opaque fill was never transparent to begin with) to the
  same `fill: 'none'`-plus-dot mechanism `caries`/`caries_treated` already
  used, immediately reintroducing the exact same gap for itself. **Any future
  status that fills `'none'` with no side-view symbol of its own needs to
  be added here too** — this isn't a one-time list, and forgetting an
  entry reproduces the exact same bug silently, the same way skipping
  `FLAT_INNER_STATUSES` lets two statuses meant to look alike quietly
  drift apart (see that note under "Tlorisni pogled" above).
- **Exception — `abrasion` (tooth wear) does not tint the whole crown
  red.** The crown keeps its normal white fill (`isAbrasion` is folded into
  the same white-fill branch as `isHealthy`/`isEndoStatus` in
  `ToothSideView.tsx`) — mirroring the tloris view's own abrasion
  treatment, which redraws a line rather than filling a region (see the
  `abrasion` exception under "Tlorisni pogled" above). Instead, the crown's
  own outline (mesial, distal, and incisal/occlusal edges alike, wherever
  the traced silhouette passes through the crown's own y-range) is traced
  in the same red (`#9D1616`, `ABRASION_EDGE_COLOR`), **2px** wide
  (`ABRASION_EDGE_STROKE_WIDTH`) — narrowed down from an initial 3px
  (matching the tloris view's own abrasion/endo weight) per Monika's
  follow-up request, once she'd seen the 3px version on localhost.
  Went through two rounds of correction before landing here, both caught
  only by checking on localhost (see the workflow note under "Coding
  Conventions" below — neither would have been obvious from the geometry
  math alone):
  - **First version filled a thin band** at the biting edge instead of
    outlining it — reverted once Monika clarified she meant "the whole
    edge of the crown," i.e. its outline, not a partial interior fill.
  - **Second version stroked the outline from *inside* the silhouette-clipped
    `<g>`** that already wraps the crown/root fill and ink-detail layers
    (`ToothSideViewContent`). Since the stroke is centered on that exact
    same silhouette path, half its width — the outward-facing half — was
    clipped away by the very shape it was tracing, so a "3px" line
    actually rendered at roughly half that weight. Monika caught this
    ("the line looks way thinner than 3px") without knowing the cause; the
    fix was moving the outline path to a sibling position *outside* that
    `<g>`, so the silhouette clip no longer touches it.
  That fix introduced its own follow-up problem: drawn unclipped, the
  stroke's outward half would bleed across the *entire* perimeter,
  including down past the gumline into the root's own outline — not
  wanted, since only the crown's edge should read as marked. The outline
  is now clipped by its own dedicated rect (`abrasionClipId`), padded
  generously on the bite-edge and mesial/distal sides (enough to let the
  stroke's outward half show in full — the padding is `abrasionStrokeWidth`
  itself, so a wider line automatically gets more room) but held **exactly
  tight at `profile.gingivaY`**, the crown/root boundary — so the visible
  line still traces only the crown's own edge, not the root's.
  **strokeWidth needed its own unit conversion**, not the flat 2 above:
  `ToothSideView`'s viewBox is in each tooth's raw traced-photo pixel space
  (`profile.width`/`profile.height`, typically hundreds of units), not the
  near-1:1 units the tloris view's own 28×28 viewBox uses — so a flat `2`
  read as far thinner on screen than the tloris view's own line at the
  same nominal weight. The actual stroke width passed to the `<path>` is
  `ABRASION_EDGE_STROKE_WIDTH * (profile.width / profile.displayWidth)` —
  that ratio converts a flat "2 real on-screen px" target into this
  tooth's own raw viewBox units, so every tooth's line reads as the same
  physical thickness regardless of how large its own traced source photo
  was. Both `ToothSideView`'s own `<svg>` and the per-tooth nested `<svg>`
  inside `PerioGraphRow` needed `style={{ overflow: 'visible' }}` added —
  same reasoning as the dental post's own triangle tip (see "Dental post"
  below): the outward bleed at the bite edge sits right at the viewBox's
  own boundary, which SVG clips by default unless overflow is opened up.
- **Exception — `implant` replaces the root with a fixture glyph, not the
  traced tooth root.** `ImplantFixture` in `ToothSideView.tsx` draws a
  two-tone fixture in place of it, matched against a reference photo: a tan
  abutment collar right at the gumline (`#D6B98C`, stroke `#8B6F47`), then a
  blue-grey screw (`#8C9CAB`, stroke `#4A5966`) with a straight cylindrical
  outline — not tapered/zigzagged — ending in a blunt, gently rounded-off
  tip rather than a sharp point. The threads are 5 dense internal ridge
  lines (fewer and more widely spaced than an earlier version's 9, which
  read as busy/faint — 5 stands out more clearly at this chart's small
  on-screen size) drawn *across* the shaft's full width as surface detail,
  not the shaft's own silhouette (an earlier version zigzagged the outline
  itself between a wider "crest" and narrower "root" at each step, which
  read as jagged/gear-like rather than a clean screw — reverted after
  checking against the reference photo). Each line tilts slightly (all in
  the same direction, offset by a fraction of the gap between threads)
  rather than running perfectly horizontal, so they read as one continuous
  helical thread wrapping the screw instead of a stack of flat rings. Both
  colors are deliberately bolder/more saturated than the rest of the
  chart's palette, so the fixture visually stands out as a different
  material rather than blending in with the other teeth's roots.
  **Length is fixed, not per-tooth**: every fixture uses the same real
  root length — tooth 48's (`REFERENCE_ROOT_LENGTH_MM`, 11mm, tied for the
  shortest root in the whole `toothAnatomy.ts` table — with a ×0.97 safety
  margin against `gingivaY`'s px rounding, so no tooth's own root zone is
  ever too short to contain it) — converted into each tooth's own raw-pixel
  space via that tooth's `height / totalLengthMm` ratio, rather than a
  fraction of *that* tooth's own (very different) root length. Otherwise a
  canine's implant (17mm root) would render visibly longer than a lateral
  incisor's (13mm root) even though real implant fixtures come in a
  handful of standard lengths, not one scaled per tooth. The
  traced natural root (both its base fill and the `detail` ink layer) is
  clipped to the crown zone only for this status, so no root-shaped
  remnants show through behind the fixture. The crown itself is
  unaffected — still the tooth's own traced crown shape, just filled with
  the usual implant purple (kept deliberately, not recolored to white to
  match the reference photo, so implant still reads via the same flat
  status-color convention as every other status in the legend). The
  fixture is horizontally centered on `ToothProfile.crownCenterX`, not
  `width / 2` — a traced crown isn't necessarily centered in its own photo
  bounding box (cusp curvature/lean shifts it, visibly on some molars, e.g.
  ~5px on tooth 48's ~63px-wide crown), so `width / 2` visibly mis-centered
  the screw under the crown for those teeth. `crownCenterX` is computed
  once in `toothProfiles.ts`'s `buildProfiles()` (not per-render): the
  `svg-path-properties` package walks the traced silhouette at 200 evenly
  spaced arc-length samples, keeps only the samples whose y falls within
  that tooth's own crown zone (same convention as `ToothSideViewContent`'s
  `crownTop`/`crownHeight`), and takes the midpoint of their x range.
- Upper teeth: crown at the bottom of the viewBox, roots up top (rendered
  crown-down); Lower teeth: crown at the top, roots down.
- **Sizing is anatomical, not photo-derived.** The 32 source photos were
  cropped independently with no shared scale reference, so their pixel
  dimensions can't be trusted for size — only for each tooth's own
  silhouette *shape*. `toothAnatomy.ts` holds standard published average
  adult crown-length + root-length (mm) per tooth type, upper and lower
  separately (textbook averages, e.g. Wheeler's Dental Anatomy — not
  measurements of any real patient). `toothProfiles.ts` combines the two:
  one shared `PX_PER_MM` scale (currently `3`) converts each tooth's real
  `crownLengthMm + rootLengthMm` into its on-screen `displayHeight`; the
  tooth's `displayWidth` then follows the *same* scale factor applied to
  its own traced pixel width, preserving that tooth's true aspect ratio
  (no distortion) while anchoring absolute size to real mm — this is what
  makes a canine actually render longer-rooted than a lateral incisor, and
  what the perio ruler's mm ticks are measured against.
- **Column width is one fixed value for every tooth**, not matched
  per-position or per-pair (`COLUMN_WIDTH` in `toothProfiles.ts`, sized to
  fit the single widest tooth in the whole set). Matching column width to
  each upper/lower pair's own widest tooth — the first approach — made
  narrower teeth sit in a much wider box than they needed, centered with
  uneven leftover space, so the visible gap between neighbors varied
  depending on how much slack each tooth had. A single fixed width makes
  every column contribute the same footprint to the row, so gaps read as
  genuinely uniform everywhere, and upper/lower alignment falls out for
  free since every column is the same size regardless of position or arch.
  Trade-off: tooth *width* is no longer to real-world scale (only height
  is) — a deliberate layout choice, not a data gap. `COLUMN_GAP` (`4`) is
  the fixed gap between every pair of adjacent columns.
- **Display scale — CSS `zoom`, not `PX_PER_MM`.** At `PX_PER_MM = 3` the
  whole chart's native footprint is only ~700px wide, tiny on a real
  monitor. `DentalChart.tsx` wraps its two `ArchRow`s in a `zoom: 1.3` div
  to fill more of the screen instead — capped at `1.3` rather than higher so
  one arch (~930px zoomed, ~1030px including the panel's own padding) fits
  comfortably without horizontal scrolling on a 13" laptop screen (~1280px
  logical width at typical scaling). This is deliberately *not* done by
  raising `PX_PER_MM`: that constant only scales the side-view/column-width
  math, but the tloris (top-view) squares are a hardcoded `26×26px` button
  in `TlorisRow.tsx`, independent of `PX_PER_MM` — bumping the constant
  alone would enlarge the side view and columns while leaving the tloris
  squares small and now-disproportionate within their wider column. `zoom`
  scales every fixed-pixel element uniformly (SVGs, the tloris button,
  borders, text) with one change, keeping the whole chart visually
  consistent. Known limitation: `zoom` lacked Firefox support until
  Firefox 126 (2024) — fine for Monika's actual browser, but worth knowing
  if the app is ever tested somewhere older. The two page-level containers
  (`StatusShowcase.tsx`, `PatientChart.tsx`) also widened from
  `max-w-[1180px]` to `max-w-[1800px]` so the now-larger chart has room to
  actually use the wider panel instead of triggering horizontal scroll.

### Layout per quadrant (not per tooth — see perio graph below)
Upper and lower arches now stack their rows as a true top-to-bottom
mirror of each other — flip the whole chart across a horizontal line and
the upper arch's stack lines up exactly with the lower arch's, per
Monika's explicit request, echoing how the two arches actually meet at
the bite line anatomically:
```
[Upper arch]                      [Lower arch]
  tnum                              globina žepka (oralno/lingvalno)
  stranski pogled + REC             mostiček (če obstaja)
  (korenine gor)                    tlorisni pogled
  globina žepka (vestibularno)      globina žepka (vestibularno/bukalno)
  tlorisni pogled                   stranski pogled + REC
  mostiček (če obstaja)             (korenine dol)
  globina žepka (oralno/lingvalno)  tnum
```
Which pocket-depth row is vestibular (buccal) vs. oral (lingual) follows
the *same* top=buccal/bottom=lingual (upper arch) or top=lingual/
bottom=buccal (lower arch) convention already used for the tloris squares'
own surface zones (see `zoneSurfaces` in `ToothTopView.tsx`) — a reading's
position in this stack means the same anatomical thing it means there.

**`tnum` used to sit at the bottom of both arches** — innermost (closest
to the tloris squares) for the upper arch, outermost (below the tooth
artwork) for the lower arch, per earlier feedback that it read better
there. Per Monika's later, explicit follow-up request, the upper arch's
`tnum` moved to the very top instead, above the side-view teeth — the one
change needed to make the whole stack a genuine mirror end to end.
`QuadrantBlock` in `ArchRow.tsx` composes `number`/`graph`/`pdAndTloris`
in `[number, graph, pdAndTloris]` order for the upper arch now, the exact
reverse of the lower arch's unchanged `[pdAndTloris, graph, number]`.

**`mostiček` sits on opposite sides of `tlorisni pogled` between the two
arches** — above it on the lower arch, below it on the upper arch (`flip`
on `BridgeRow`, see "Bridge display" below), so the dental post triangle
(see "Dental post" below), which reaches outward from the tloris square's
own top edge on the upper arch and bottom edge on the lower arch, never
collides with it. This reads as an asymmetry at first glance, but it
isn't one: a true vertical mirror naturally swaps "above" and "below" for
everything it reflects, so `mostiček` sitting on the opposite side of
`tlorisni pogled` on each arch is exactly what the mirror in the diagram
above already predicts, not an exception to it. `tnum`'s old
never-moves-to-the-top-on-the-upper-arch behavior was the actual
exception — now fixed, the mirror holds for every row, `mostiček`
included.

### Status color palette
| Status | Color | Notes |
|---|---|---|
| healthy | none (transparent) | Blank — no fill reads as untouched |
| caries | none (transparent) | Label "Karies / poka" — a fracture/crack is marked exactly the same way as caries, see the `fracture` removal note below. No whole-surface fill (was coral, `#F0997B`) — a 3px red (`#E94949`, `TODO_COLOR`) dot at the center of each affected surface instead. Still needs treatment — see "Tlorisni pogled" below |
| caries_treated | none (transparent) | Relabeled "Plomba" (was "Karies (sanirano)") — once treated, that surface simply *is* a filling. Same dot marker as `caries`, blue (`#1412A9`, `DONE_COLOR`) instead of red — treatment done |
| filling | none (transparent) | Relabeled "Plomba (obstoječa)" (was flat `#FFFFFF`) — a pre-existing restoration, already there before this practice started tracking the tooth, per Monika's explicit request that this render the same grey-dot way `endo_existing`/`overlay_existing` do rather than a flat fill: "a patient can come with many amalgam fillings and these should be marked." Same per-surface dot mechanism as `caries`/`caries_treated`, grey (`#8a8f94`, `STATUS_COLOR`) — see "Tlorisni pogled" below |
| crown | #9FE1CB | Teal. Also used for a bridge anchor tooth (there's no separate `bridge_anchor` status anymore, per Monika's explicit request — see "Bridge display" below) and for a prosthesis anchor (`prosthesis_crown`, its own status, below) |
| implant | #CECBF6 | Purple fill, crown only (the root is a metal fixture instead, see "Stranski pogled" below); border `#1f1e20` — same dark color as every ordinary tooth's outline (was a saturated purple, `#534AB7`, paired with the fill; unified per Monika's explicit request) |
| overlay_planned | none (transparent) | Tooth renders completely normally in both views (no fill/symbol change, per-surface findings untouched) — marked entirely by a 3px red (`#E94949`, `TODO_COLOR`) "[" -shaped cap wrapping the tloris square's own edge, drawn in `BridgeRow`'s shared row. See "Bridge display" below |
| overlay | none (transparent) | Same as `overlay_planned`, but the cap is blue (`#1412A9`, `DONE_COLOR`) instead of red — restoration done. See "Bridge display" below |
| overlay_existing | none (transparent) | Same cap again, grey (`#8a8f94`, `STATUS_COLOR`) instead of red/blue — an overlay already present before this practice started tracking the tooth. See "Bridge display" below |
| extraction_planned | none (transparent) | Tooth is still fully present (normal fill/border/detail, per-surface findings untouched) — a 3px red (`#E94949`, `TODO_COLOR`) X-cross over the whole tooth in both views marks it for removal. See "Absent tooth: missing / extraction / extracted" below |
| extracted | `#EBE9E3` (`ABSENT_SILHOUETTE_COLOR`) | Flat, uniformly light silhouette (no crown/root split, no ink detail, no outline) with a 3px blue (`#1412A9`, `DONE_COLOR`) X-cross on top, in both views — marks a position that used to have a tooth. See "Absent tooth: missing / extraction / extracted" below |
| missing | `#EBE9E3` (`ABSENT_SILHOUETTE_COLOR`) | Same flat light silhouette as `extracted`, but no symbol at all — nothing was ever there to cross out. See "Absent tooth: missing / extraction / extracted" below |
| prosthesis | — | Tloris view: X cross on a **circle**, not the usual square, in the same dark color as a normal tooth outline, solid border not dashed. Side view: blank — no crown, root, X cross, or outline, same as `bridge_pontic` — see "Tlorisni pogled" / "Stranski pogled" below |
| prosthesis_crown | #9FE1CB | Same as `crown` in both views — flat whole-square fill, no subdivisions (`FLAT_INNER_STATUSES`), no other special-case rendering. Joins the same connector line `prosthesis` teeth get (`isProsthesisLink()`) — see "Tlorisni pogled" below. Not shown in the Legenda swatch grid (`StatusLegend.tsx`'s `ORDER`) — it renders identically to `crown` there (the connector line only shows up on the real chart, not an isolated swatch), so it would just be the same teal square twice; per Monika's explicit request |
| bridge_pontic | none (transparent) | Solid (not dashed) border + X-cross, both the same dark color as every other tooth's own outline (not red or grey) in the tloris square. Side view: blank — neither crown, root, nor outline drawn at all — see "Bridge display" below. The bracket connecting anchors to pontics is a separate row (`BridgeRow`), not drawn on the tooth itself |

Endodontic treatment (kanal) isn't in this table anymore — `endo`/
`endo_planned`/`endo_existing` used to be three `ToothStatus` values here,
but they've since been pulled out into an independent `EndoStage` field
(`ToothData.endo`) so a tooth can have endo *and* some other status (a
filling, say) at once — see "Canal display" below for the full symbol/
color spec and the reasoning behind the move.

`fracture` ("zlom / razpoka") was removed from `ToothStatus` entirely, per
Monika's explicit request — a fracture/crack is "basically karies, but
also indicates other defects that need fixing with filling," so it's
marked exactly the same way caries already is: a red dot (`TODO_COLOR`) on
the affected surface while it still needs treatment, turning blue
(`DONE_COLOR`) once fixed, via the existing `caries`/`caries_treated`
statuses — see the `caries`/
`caries_treated` per-surface dot exception under "Tlorisni pogled" above.
No new status, symbol, or color was added for this; a dedicated
`fracture` status (its own coral fill + a jagged-line `StatusSymbol`
glyph) previously existed and rendered near-identically to old `caries`'s
own flat fill, which was the redundancy Monika flagged. Removed along with
it: the `fracture` entry from `STATUS_STYLES` (`statusStyles.ts`), the
`'fracture'` glyph case from `StatusSymbol.tsx` and its `symbol` prop
union, the `style?.symbol === 'fracture'` render block in
`ToothSideView.tsx`, and its entry from `StatusLegend.tsx`'s `ORDER` list
and `StatusShowcase.tsx`'s example grid.

`bridge_anchor`, `planned` (the generic "Načrtovano zdravljenje" status),
`granuloma`, and `diastema` were all removed from `ToothStatus` entirely
too, per Monika's explicit request during the same review that renamed
caries/caries_treated/filling above:
- **`bridge_anchor`** → a bridge anchor tooth is just a plain `crown`
  now (see the `crown` row above and "Bridge display" below) — "this is
  prevleka where bridge is fixed on." `isAnchorStatus()` (`BridgeRow.tsx`)
  checks `crown`/`implant` for anchor purposes; `bridge_pontic` itself no
  longer needs to be included there now that bridge grouping is explicit
  rather than inferred from adjacent statuses — see "Bridge display"
  below.
- **`planned`** → removed as redundant with `endo_planned` ("Endodontsko
  zdravljenje (potrebno / v teku)"), which already covers the same
  ground.
- **`granuloma`** → removed outright, along with its dedicated
  `'granuloma-circle'` `StatusSymbol` type (`ui/StatusSymbol.tsx`) and its
  root-tip rendering in `ToothSideView.tsx` (the `rootTipY`/`tipBox`
  locals that existed only to position it were dead code once the symbol
  went, so both were deleted too).
- **`diastema`** → removed outright; it had no special-case rendering
  logic anywhere (a pure flat-fill fallthrough), so removal was just
  deleting its `STATUS_STYLES` entry, `ToothStatus` member, and demo
  entries.
- **`root_only`** ("Samo korenina") → removed outright too, in a later
  pass — it had no special-case rendering logic either (like `diastema`,
  a pure fallthrough: `fill: 'none'` with no symbol, so it just showed the
  see-through-grey root color with a blank crown, no dedicated code path
  of its own), so removal was the same shape: deleting its
  `STATUS_STYLES` entry, `ToothStatus` member, and its `EXAMPLES` demo
  entry (tooth 25, which keeps its separate, unrelated `caries_treated`
  demo in `MOCK_SURFACES` for "Cela karta"). It had already been dropped
  from `StatusLegend.tsx`'s `ORDER` in an earlier, smaller request before
  being removed entirely here — see "Healthy-tooth coloring" above for
  what its removal leaves behind in `ToothSideView.tsx`'s crown-fill logic.

Two statuses exist in `ToothStatus` but were never in Monika's original
color spec — implemented with a first-proposal color each, not yet
confirmed:

| Status | Color | Notes |
|---|---|---|
| abrasion | #9D1616 | Tloris: red mark on the incisal-edge line or occlusal-surface box only, not a full-tooth fill — see "Tlorisni pogled" above. Side view: crown stays white, its own outline traced in red (2px) instead of a full-crown fill — see "Stranski pogled" above. Darkened from an earlier `#D4537E` per Monika's explicit request. Proposed, unconfirmed |
| impacted | #D8D5CC | Grey, dashed border for the silhouette itself (fill/border colors unchanged, still unconfirmed) — but its *position* in the side view (submerged below the gumline, root clipped at the row's last ruler line), tloris-blank rendering, and forced-flat gumline/REC number are all built and confirmed on localhost — see "Impacted tooth" below |

### Perio graph (pocket depth + gum margin)

**Status: built, matches a live example Monika reacted to (Curve Dental's
periodontal chart), iterated against her feedback.** This superseded the
original simpler "vertical line + hidden-below-2mm" spec below — the
richer version was built directly against her requests, so treat this
section as current and the plan above (column layout) as its companion,
not the old bullet list.

**PerioGraphRow** (one per quadrant, so 4 per full chart) renders the
side-view teeth for that quadrant *and* a continuous mm ruler + gumline in
one shared SVG, modeled on Curve Dental's periodontal chart:
- Every tooth's CEJ is aligned to **one flat baseline** across the whole
  quadrant (`cejY`), computed from the row's own tallest root/crown via the
  same `PX_PER_MM` scale as tooth sizing — this only works because sizing
  is anatomically real (see above); it wasn't achievable when teeth were
  sized from arbitrary photo crops.
- A faint ruler (`#e2e8e6`, one tick every 2mm) runs behind everything,
  labeled in mm with the zero line marked "CEJ".
- The **gumline** is a real polyline through 3 points per tooth (mesial,
  mid, distal), plotted from `gumMargin` (signed mm from CEJ — see
  `GumMargin` in the types above). It renders *on top of* every tooth's
  artwork (drawn last in the SVG), not underneath, so it's visible crossing
  the crowns the way Curve Dental's is, not painted over by them.
- **REC** (gum-margin) readings are labeled in blue (`#4C7093`) just past
  the deepest root tip in the row, shown as a plain magnitude (no "−")
  since recession is the expected clinical case and the sign reads as
  noise once the line's own position already shows the direction.
- Data-driven, not decorative: a tooth with **no** `gumMargin` entry shows
  no line/number at all for that tooth (never recorded) — that's different
  from an entry of `[0,0,0]` (recorded, healthy). Same rule applies to
  pocket depth below.
- Simplification: the app only tracks one gumline (buccal), not a second
  for lingual — CLAUDE.md's `ToothData.gumMargin` does have both surfaces,
  so a lingual line is a natural future addition, not a data-model change.

**PocketDepthRow** (rendered twice per quadrant — see column layout above)
shows probing depth (PD), one row per surface (vestibular/buccal, oral/
lingual), positioned directly against the tloris squares rather than out
by the roots — per Monika's explicit feedback that both surfaces needed to
be visible at once, and that PD next to the gumline (the first design)
landed on top of the tooth artwork once the line could move for recession.
- 3 points per tooth (mesial, mid, distal), always shown as a colored
  circle + number — unlike the original spec, values ≤2mm are **not**
  hidden anymore; showing every value, like Curve Dental does, reads
  better as a continuous row than a plan with unexplained gaps.
- Color: ≥4mm → `#D4537E` (red), 3mm → `#EF9F27` (amber), ≤2mm → `#6f7c79`
  (neutral grey, still shown).
- Color thresholds and mesial/mid/distal x-positions are shared with
  `RecLabels` via `perioStyle.ts` so the two stay visually consistent.
- **Bleeding on probing (BOP)**: each point's circle outline turns red
  (`#D4537E`) and 3px thick instead of the usual thin depth-colored ring,
  driven by `ToothData.bleeding.buccal`/`.lingual` (`BleedingPoints` —
  same mesial/mid/distal shape as `PocketDepths`). There's no room for a
  separate concentric ring around the dot: points sit ~12px apart
  (`COLUMN_WIDTH` × the 0.3 gap between `POINT_X_FRACTIONS`), barely more
  than the circle's own ~9–10px footprint once bled, so BOP recolors the
  existing circle's own outline rather than adding a second one alongside
  it. Same "no entry = never recorded" rule as pockets/gum margin applies.
  The red is `perioStyle.ts`'s exported `BOP_COLOR` (same value as the
  ≥4mm pocket-depth threshold, since both flag the same severity) —
  `StatusLegend.tsx` renders one extra hand-added entry (a small white
  circle with the same red 3px ring) after its `ORDER`-mapped `ToothStatus`
  swatches, since BOP is a per-point perio-graph flag, not a tooth status,
  so it was never going to appear via the status loop.

### Perio data entry (click-to-focus + type-a-number)

**Status: built**, `PatientChart.tsx` only — `StatusShowcase.tsx`'s
read-only chart simply never passes the props below, so nothing there
becomes interactive. Until this, `PocketDepthRow`/`PerioGraphRow` above
only ever rendered from static props — there was no way to actually enter
a pocket-depth or gum-margin reading, and `PatientChart.tsx` didn't even
pass those props into `DentalChart` at all. Deliberately a **separate**
interaction mode from the status picker/toolbar (see "Interaction
Design"), not a reuse of it: a full periodontal exam is roughly 200
individual mm numbers (3 points × 2 surfaces × 32 teeth), so speed of
entry matters far more here than for painting an occasional status.

- **Click a point, then type a digit** — no popup number-pad, no
  click-to-cycle. Clicking an unfocused point (mesial/mid/distal, on
  either a `PocketDepthRow` or the gum-margin `RecLabels` in
  `PerioGraphRow`) shows a focus ring in the same `--tooth-selected` teal
  used for chart selection elsewhere, so "what keyboard input applies to
  right now" reads consistently across the whole app. Typing `0`–`9`
  while a point is focused sets that value and **auto-advances** —
  mesial → mid → distal → the next tooth's mesial point — via
  `advancePerioPoint()` (`PatientChart.tsx`), walking the *same* quadrant
  + surface/kind the current point belongs to (`UPPER_LEFT`/
  `UPPER_RIGHT`/`LOWER_LEFT`/`LOWER_RIGHT`, `toothMeta.ts`). Deliberately
  stops at the end of a quadrant's row (clears focus) rather than
  crossing into a sibling row — PD buccal → PD lingual, or across
  arches — a fresh click starts the next row. Single digit only for
  now: real probing depths are almost always single-digit, and the
  visible circle only has room for one character anyway; a two-digit UI
  is future work, not a data-model change.
- **The same point doubles as a second control — bleeding on probing
  (BOP) for a pocket-depth point, recession-vs-overgrowth sign for a
  gum-margin point.** Real estate is tight (points sit ~12px apart, the
  same reason BOP is already a ring-color change rather than a second
  ring — see "Perio graph" above), so rather than add a whole new visible
  toggle next to every point, clicking an **already-focused** point again
  toggles that flag in place — `toggleBleeding()`/`toggleGumSign()`
  (`PatientChart.tsx`) — without touching the number. A gum-margin point
  with no value yet is a no-op to sign-toggle (nothing to flip the sign
  of before a digit's been typed there). Holding **Shift** while typing a
  digit toggles the same flag as a one-keystroke shortcut, calling the
  exact same `toggleBleeding()`/`toggleGumSign()` functions so the two
  mechanisms can never disagree; a plain digit never touches the flag, so
  correcting a depth later never silently un-marks a point that was
  already flagged. A brand-new gum-margin point defaults to **negative**
  (recession, the common clinical case, and what the REC label's
  no-sign-shown convention already assumes) — typing a plain digit
  preserves whatever sign was already there.
- **Mutual exclusion with the status-selection mode above**: clicking a
  perio point clears the chart's status `selection`
  (`handlePerioPointClick`), and clicking a chart status target clears
  `focusedPerioPoint` (`handleTargetClick`) — entering numbers and
  painting statuses are two separate modes, so starting one exits the
  other cleanly, the same way `bridgeMessage` gets cleared by either too.
- **Nullable per-point tuples**: `PocketDepths`/`GumMargin`
  (`types/dental.ts`) widened from `[number, number, number]` to
  `[number | null, number | null, number | null]` to support partial
  entry — a `null` at one index means "this specific point not yet
  entered," distinct from the outer `Record<string, PocketDepths>` key
  being absent entirely ("this tooth has no data at all"). The gumline
  polyline in `PerioGraphRow` still falls back to `0` per null point for
  its own continuous line (`gm[j] ?? 0`) — a visual guide, not the
  data-driven number/label, which stays hidden for a null point per the
  existing "no entry = nothing shown" rule.
- **Placeholder circles**: a faint dashed grey circle
  (`PLACEHOLDER_COLOR`, `#ccd6d4`) marks every point that's interactive
  but not yet entered, in both `PocketDepthRow` and `PerioGraphRow`'s
  `RecLabels` — added after Monika reported "there are no numbers for
  pocket depth... please fix this," traced to two causes at once: the
  click hit-targets were fully invisible (`fill/stroke: 'none'`), giving
  no visual affordance for where to click on an empty point at all, and
  `PatientChart.tsx` had no seed data in any of the five new perio state
  maps, so a fresh page load showed nothing whatsoever. The placeholder
  is gated strictly on `interactive` (i.e. `onPointClick` was actually
  passed), so it never appears on `StatusShowcase.tsx`'s read-only
  chart — that page keeps its original "nothing shows until real data
  exists" look, since there's no click to invite there. A few teeth
  (16 in the seed data) now ship with example pocket-depth/gum-margin/BOP
  readings on first load too, the same "pre-existing findings for
  editing, not just blank entry" reasoning `SEED_SURFACES`/`SEED_ENDO`
  already use.
- **`PerioPoint`** (`perioStyle.ts`) is the shared point-identity type
  both row components and `PatientChart.tsx`'s focus state key off:
  `{ kind: 'pocket', fdi, surface, index }` or `{ kind: 'gum', fdi,
  index }`, plus a `samePerioPoint()` equality helper. `PocketDepthRow`
  gained a `surface: 'buccal' | 'lingual'` prop (needed to build correct
  point identities — the two call sites already knew which surface they
  were showing, just never passed it down) alongside `onPointClick`/
  `focusedPoint`; `PerioGraphRow`'s `RecLabels` gained the same two.
  Impacted teeth are excluded from all of this (`interactive` is false
  whenever `statuses?.[fdi] === 'impacted'`) — nothing to probe on a
  tooth that's never erupted, the same rule REC display already applied
  to itself before entry existed at all.

### Bridge display (mostiček), fissure sealant (zalitje fisur), and overlay

**Status: built**, matched against a reference chart Monika provided (a
generic mockup showing a bracket over the anchor/pontic teeth, plus a
second illustrative row showing the pontic has no root — "brez korenine").
Fissure sealant and overlay were both added later into this same
component, per Monika's explicit request that each "share the same gap"
the bridge bracket already occupies rather than get a row of its own.
Four pieces:

- **`BridgeRow.tsx`** (one per quadrant, so 4 per full chart) draws the
  bracket: a horizontal line spanning from the first anchor tooth's column
  center to the last, with ticks connecting it to `TlorisRow`, plus a
  small tilde per fissure-sealant tooth in the same shared SVG. By default
  the row sits *above* the tloris squares — the wrapper carries `-mb-1` to
  cancel the parent flex stack's own `gap-1` (4px) immediately below this
  row, so its own bottom edge touches `TlorisRow` directly; zero internal
  margin alone wasn't enough, since that flex gap sits between rows
  regardless of their own internal padding. The gap on the *other* side
  (to the pocket-depth numbers row) is deliberately left as the
  *unmodified* `gap-1` — no `-mt-1`.
  **Both the bracket's own bar and the sealant tilde center on `midGapY`**
  — not this row's own vertical center, but the true midpoint of the
  *combined* 8px gap between `TlorisRow` and the pocket-depth numbers row
  (4px plain `gap-1` + this row's own 4px `ROW_HEIGHT`, stacked). That
  combined gap's exact midpoint lands precisely on this row's own edge
  that does *not* touch `TlorisRow` (`tickEndY` is the opposite, touching
  edge) — `midGapY = flip ? ROW_HEIGHT : 0`. The bracket's ticks span the
  row's own full height to reach from `midGapY` down/up to `tickEndY`,
  rather than stopping at a small fixed inset the way an earlier version
  did — per Monika's explicit request that the bracket's own line match
  the sealant tilde's positioning exactly, once the tilde was moved there
  first (see the sealant bullet below for why the tilde needed that
  positioning in the first place). Both the bracket (`BRACKET_COLOR`,
  `#8a8f94`) and the sealant tilde now share this exact color and a **2px**
  stroke (`BRACKET_STROKE_WIDTH`/`SEALANT_STROKE_WIDTH`) — both widened
  from an initial 1px per Monika's explicit request, and the sealant
  color/weight was pinned to match the bracket's own exactly (dropping an
  earlier dedicated blue and a 3px-then-2px weight of its own) once she
  confirmed "same color as boxes" meant the bracket, not the tloris square
  outline.
  **A `flip` prop mirrors all of this vertically** — the whole row below
  `TlorisRow` instead of above, `-mt-1` instead of `-mb-1` — used on the
  **upper arch only** (`ArchRow.tsx` passes `flip={arch === 'upper'}`).
  This was added after Monika found the bracket colliding with the dental
  post: the post triangle points outward from the tloris square's own top
  edge on the upper arch, bottom edge on the lower arch (see "Dental post"
  below) — the default (unflipped) row sits on the tloris square's *top*
  edge, which is exactly where the post also reaches on the upper arch, so
  the two would draw on top of each other there. The lower arch was never
  affected (post points down, row stays on the unflipped top edge —
  already opposite sides) and keeps the default, per Monika's explicit
  confirmation that "the lower arch is fine as it is." **No text label**
  on the bracket — the app is read by dental professionals, who don't need
  "mostiček 14-16" spelled out; the bracket shape alone says it, per
  Monika's explicit feedback.
  **The bracket comes from explicit selection, not from scanning `statuses`
  for adjacent crown/implant/bridge_pontic runs** — the opposite of every
  earlier version of this feature (see the full history below). Forming a
  bridge is a deliberate act: select an existing anchor tooth (already
  `crown` or `implant`) together with the teeth that should become its
  pontics, then click "Člen mostu" in `StatusToolbar` — a dedicated
  handler, `handleCreateBridge()` (`PatientChart.tsx`), special-cased ahead
  of the generic apply-status-to-every-selected-target path every other
  status uses (`handleStatusClick`). That one action populates
  `bridgeGroupByFdi`, a plain `fdi → group-id` map threaded down
  `DentalChart` → `ArchRow` → `BridgeRow` (mirroring `postByFdi`/
  `endoByFdi`) — `BridgeRow`'s own `findBridgeGroups()` only ever draws a
  bracket for teeth recorded there together, filtered per quadrant.
  **Only ONE anchor needs to already exist in the selection** — not both
  ends: a cantilever bridge (one anchor, one or more pontics, no anchor at
  the far end) is a real clinical case and needs no special handling, since
  `handleCreateBridge` only requires `anchors.length >= 1`. The anchor
  tooth's own status is left completely untouched (still `crown`/
  `implant`, fixture rendering unaffected); only the *other* selected teeth
  become `bridge_pontic`. A selection with no pre-existing anchor at all,
  or with fewer than two distinct teeth, or spanning more than one
  quadrant (a bridge never crosses a quadrant boundary — one `BridgeRow`
  per quadrant), creates no bridge — but unlike the toolbar's other
  whole-tooth actions (`handleTogglePost`/`handleSetEndoStage`), which
  silently no-op on an empty selection, each of these failure paths sets a
  specific `bridgeMessage` explaining why, shown under the page header
  until the next chart click. A group's membership is still re-validated
  against CURRENT statuses on every render, not blindly trusted — so a
  tooth whose status later changes away from what a bridge needs (an
  anchor edited to something else, a pontic overwritten by a different
  status via `ToothDetailPanel`) just quietly stops extending the bracket,
  without `bridgeGroupByFdi` itself needing to be actively cleaned up
  wherever a status can change.

  **This replaces three earlier, purely status-driven detection schemes,**
  all of which inferred a bridge from whichever crown/implant/bridge_pontic
  statuses happened to sit next to each other after the fact rather than
  recording an actual decision to bridge specific teeth together:
  1. *Loose*: bracket any contiguous run containing a pontic, no
     requirement that either end be a real anchor.
  2. *Strict, either anchor type*: require the run to start and end on an
     anchor, `crown` or `implant`, either combination allowed.
  3. *Strict, matching anchor type*: tightened further to require both
     ends be the *same* anchor type, per an earlier (and, it turned out,
     mistaken) clinical correction that a mixed crown/implant pair "isn't
     a real-world case."

  Versions 2 and 3 both shared the same failure mode Monika reported
  repeatedly: a bridge not yet closed off by a real anchor on *both*
  sides — a lone pontic with nothing set next to it, a pontic next to only
  one anchor — drew nothing at all, reading as "the bracket is broken."
  Loosening the match (version 1, and briefly again after 3) fixed that but
  produced the opposite failure instead: a tooth merely set to
  `bridge_pontic` right next to an *unrelated* pre-existing crown/implant —
  no intent to bridge the two at all — got silently welded into a phantom
  bridge with it (the teeth-22/24-next-to-implant-21 case), and an isolated
  pontic with no neighbors produced a degenerate zero-width "bracket," a
  stray vertical tick with nothing to actually span. No purely
  status-driven rule can win both ways at once, because adjacency can never
  tell "these teeth were deliberately selected together" apart from "these
  statuses just happen to be next to each other" — which is exactly why the
  feature moved to explicit selection instead of one more adjacency rule.
  See `findBridgeGroups()`'s own comment in `BridgeRow.tsx` and
  `handleCreateBridge()`'s in `PatientChart.tsx` for the mechanism in full.
  Composed into `ArchRow.tsx`'s `pdAndTloris` block, always immediately
  adjacent to `TlorisRow` — between the vestibular/oral `PocketDepthRow`
  and `TlorisRow` on the lower arch (matching the "Layout per quadrant"
  diagram above), or between `TlorisRow` and the *other* `PocketDepthRow`
  on the upper arch, where `flip` moves it. **Always renders its full row
  height even with nothing to show in a given quadrant** (just empty) —
  omitting it entirely when unused would make that quadrant's stack one
  row shorter than its sibling, breaking the upper/lower and left/right
  alignment every other row in this chart depends on. **The
  `BRIDGE_ROW_HEIGHT` spacer this forces onto a `PocketDepthRow`** (see
  "Dental post" below for why it exists) moves with the flip too — it's
  on the *bottom* `PocketDepthRow` for the lower arch (unflipped: this row
  sits above `TlorisRow`, so the extra spacing balances the bottom side,
  which has nothing there) and on the *top* `PocketDepthRow` for the upper
  arch (flipped: this row now sits below `TlorisRow` instead, so the top
  side is the one that needs the extra spacing to match).
- **Fissure sealant (`sealant_planned`/`sealant`/`sealant_existing`
  statuses)** marks a tooth whose occlusal fissures have been (or will be)
  sealed as a preventive measure — a real three-state `ToothStatus` set
  now, same shape as `overlay_planned`/`overlay`/`overlay_existing` right
  below. **This used to be an independent field** (`ToothData.sealant`, a
  `SealantStage` type, threaded like `post` — `DentalChart` → `ArchRow` →
  `QuadrantBlock` → `BridgeRow` via a `sealantByFdi` prop — rather than a
  status), specifically so it could combine freely with whatever else was
  going on for a tooth without competing for the single `surfaces.all`
  slot, the same reasoning `post` still uses today. Per Monika's explicit
  clinical correction, that premise was wrong: sealant and a status like
  implant are not compliant services on the same tooth, so there was never
  a real case needing that combination — the original demo doing exactly
  that (teeth 21/37, implant + planned/done sealant together) was itself
  clinically invalid. `SealantStage`, `ToothData.sealant`, and the
  `sealantByFdi` prop chain have all been removed entirely; the type union,
  `STATUS_STYLES`, and `STATUS_ORDER` (`statusStyles.ts`) are now the only
  place its three states live, exactly like `overlay`'s own pair-plus-
  existing-state. (Endo went the *opposite* direction later — see "Canal
  display" above: it started as a `ToothStatus` pair, then had to become
  an independent field for exactly the reason sealant just stopped being
  one — a genuine need to coexist with another status. The two moves
  aren't a contradiction; each field just landed wherever its own real
  clinical constraint pointed.)
  **Rendering is otherwise unchanged**: still a small tilde (`~`), drawn
  procedurally as an SVG path (two mirrored cubic-Bézier humps) in
  `BridgeRow.tsx`'s own row, not a text glyph — consistent with every other
  symbol in this chart being a drawn shape. Centered at `midGapY` (see
  above) on the sealed tooth's own column. At its current size
  (`SEALANT_HALF_WIDTH`/`SEALANT_AMPLITUDE`, doubled once from an initial
  size per Monika's explicit request) the tilde no longer fits inside
  `BridgeRow`'s own nominal 4px-tall box, so the row's `<svg>` sets
  `overflow: visible` — the same technique already used for the dental-post
  triangle and abrasion's crown-edge outline. Color comes from
  `sealantColorFor()` (`BridgeRow.tsx`) — `TODO_COLOR` (planned),
  `DONE_COLOR` (done), or `STATUS_COLOR` (existing, the original and still
  the default look) — the same three shared colors `overlayColorFor()`
  uses for overlay below, now reading `statuses` (i.e. `surfaces.all`)
  directly instead of the removed separate prop.
  `StatusSwatch.tsx` (the shared swatch renderer both `StatusLegend.tsx`
  and the click-to-edit pickers use) draws the same tilde as its
  representative icon for all three sealant statuses, alongside the
  caries dot/overlay cap it already drew for their own statuses.
  **Demoed** on teeth 17 (upper, existing), 35 (lower, planned), and 37
  (lower, done) in `StatusShowcase.tsx`'s `MOCK_SURFACES` — 37 used to be
  a second `implant` example before this change; converting it left only
  tooth 21 demonstrating the implant fixture rendering, a real (accepted)
  reduction in tooth-shape coverage for that unrelated feature.
  **Legend**: now flows through `StatusLegend.tsx`'s ordinary
  `STATUS_ORDER`-driven grid automatically, like any other status — no
  more hand-added rows for it.
  **Schema**: the dedicated `sealant text check (...)` column in
  `tooth_records` (`supabase/schema.sql`) and the migration that added it
  (`supabase/migrations/004_add_sealant.sql`) have both been removed —
  neither had ever been run on the live project, and sealant's three
  states now live in the existing `surfaces` jsonb column like every other
  status, needing no schema change of their own.
- **Overlay (`overlay_planned`/`overlay`/`overlay_existing` statuses)**
  marks a partial-crown restoration covering the cusps — a real
  three-state `ToothStatus` set, not an independent field like `post`
  (there's no reason an overlay would need to combine with some *other*
  whole-tooth status the way a post does, so it fits the existing
  `surfaces.all` slot fine). Same planned/done/
  existing pattern and the same shared `TODO_COLOR`/`DONE_COLOR`/
  `STATUS_COLOR` as every other such pair/triple on the chart
  (caries/caries_treated, the endo-circle's own stages,
  extraction_planned/extracted) — see the caries-dot color note under
  "Tlorisni pogled" above. `overlay_existing` (grey, `STATUS_COLOR`) was
  added after the original red/blue pair, per Monika's explicit request to
  extend the missing/extraction "status vs. to-be-done vs. done" pattern
  to overlay too. None of the three has a fill or symbol of its own in
  `STATUS_STYLES` (`fill: 'none'`, no `symbol`) — the tooth's own
  per-surface findings stay fully visible in both views, unaffected, same
  reasoning as `extraction_planned`; `symbolColor` is still set on all
  three entries purely as `BridgeRow.tsx`'s own source of truth for the
  cap's color (via `overlayColorFor()`), even though nothing in the
  generic `wholeStyle.symbol` rendering pipeline reads it, since none of
  the three sets a `symbol` type. `ToothSideView.tsx` needed the same
  white-crown fix `extraction_planned` already has
  (`isOverlayStatus`, folded into the same branch, covering all three
  statuses) — otherwise a `fill: 'none'` status with no symbol of its own
  falls through to the see-through-grey look reserved for actually-absent
  tooth structure, the same bug Monika originally caught on `endo` back
  when it was still a `ToothStatus` (tooth
  36, "why is the whole tooth `#D8D5CC`") and that later resurfaced for
  `caries`/`caries_treated` too (see the "Healthy-tooth coloring"
  exception under "Stranski pogled" above).
  **Drawn as a "[" -shaped cap** wrapping the tooth's own edge — this went
  through two rounds of correction, both caught on localhost, before
  landing on its current shape:
  1. **First version floated like the sealant tilde**, centered at
     `midGapY` with short ticks touching `tickEndY` — reusing the general
     "two-state marker in this row" pattern wholesale. Monika clarified
     this wasn't what she meant: "this cap sits on the tooth," at the same
     horizontal position as the bracket/tilde but a genuinely different
     vertical treatment.
  2. **Second version put the long bar AT `tickEndY`** (correctly touching
     the tooth's own edge) with two short legs reaching *inward*, back
     toward `midGapY` — a "⊓" bracket sitting just above/below the tooth.
     Monika's follow-up ("the short lines should go over the edges so the
     tooth looks like it's wrapped") flipped the short legs' direction:
     they now continue *past* `tickEndY`, bleeding `OVERLAY_WRAP_LEN` (3
     units) further in the *same* outward direction, into the tloris
     square's own visual space rather than back into `BridgeRow`'s own
     box. That bleed needs this row's own `overflow: visible` (already set
     for the sealant tilde) — same technique as the dental-post triangle
     and abrasion's crown-edge outline.
  The long bar's own width was corrected the same way — originally a
  shorter, arbitrary `OVERLAY_CAP_HALF_WIDTH`, widened per Monika's
  explicit follow-up ("the length of the side of a square") to span
  `TOOTH_SIZE` (26px) exactly, matching the tloris square's own true edge
  length. `TOOTH_SIZE` is exported from `TlorisRow.tsx` specifically so
  `BridgeRow.tsx` reads the same value rather than a duplicated literal
  that could drift out of sync with the square's own actual size. Stroke
  is **3px** (`OVERLAY_STROKE_WIDTH`, widened once from an initial 2px),
  matching the weight `abrasion`/the endo-circle/the extraction pair all use for
  their own status markers.
  **A known paint-order caveat**: `BridgeRow` renders *before* `TlorisRow`
  in the DOM on the lower arch (unflipped) but *after* it on the upper
  arch (flipped) — see the `pdAndTloris` branches in `ArchRow.tsx`. Since
  the overlay cap's wrap now deliberately bleeds onto the tloris square's
  own visual space, paint order matters: on the upper arch `BridgeRow`
  paints on top, so the wrap always shows; on the lower arch `TlorisRow`
  paints on top instead, so the wrap could in principle end up hidden
  under a *solid-filled* tooth square there (a `crown`, `implant`, etc.)
  — not an issue for a transparent-fill tooth (`healthy`, `caries`, and
  most other statuses), which is the common case, but untested against a
  filled one as of this writing.
  **Demoed** on tooth 12 (`overlay_planned`, red) and tooth 11 (`overlay`,
  done, blue) in the main "Cela karta" chart (`MOCK_SURFACES`) — adjacent
  teeth, both states of the pair visible side by side, same as the
  extraction_planned/extracted pair. Tooth 38 (`overlay`, lower arch) was
  added specifically to exercise the paint-order caveat above, since 11/12
  are both on the upper arch. Tooth 27 (`overlay_existing`, main chart)
  and teeth 42/43/44 (`overlay_planned`/`overlay`/`overlay_existing`,
  swatch grid) cover the third state, added later.
- **`bridge_pontic`'s own rendering** reads as "no natural tooth structure
  here" **in both views**, per Monika's explicit request that it be as
  plain as possible. It went through several rounds against her feedback:
  a solid fill, a dense diagonal cross-hatch fill, then a dashed square
  with a red, then grey, X — all reverted (see "Tlorisni pogled" above
  for the fuller history) — before landing on the current state:
  `STATUS_STYLES.bridge_pontic = { fill: 'none', symbol: 'x-cross', symbolColor: '#1f1e20' }`
  (no `border`, so the square's own outline stays the default dark; no
  `borderDash`, so that outline is **solid**; `symbolColor` pinned to that
  same dark color so the cross reads as part of the same visual language
  as every other tooth, not a separate color of its own) — all read by
  `ToothTopView.tsx`'s already-generic `wholeStyle`-driven rendering, no
  pontic-specific code needed there at all. `ToothSideView.tsx` goes
  further: it hides not just the traced root (base fill, `detail` ink
  layer — the same `hidesRoot`-gated clipping `implant`/`prosthesis` also
  use) but the **crown too**, via a pontic-specific `hidesCrown` flag —
  per Monika's explicit follow-up request that a pontic have no crown
  drawn either, not even one with a fill. All three crown-layer paths
  (base grey fill, `crownFill`, `detail` ink) are conditionally skipped
  for `bridge_pontic`. A first version of this kept the dashed-outline
  path as a "ghost" marker of the crown's own shape even with nothing
  filled inside it, but Monika asked for that removed too — since
  `bridge_pontic` no longer sets `borderDash`, that path (gated on
  `style?.borderDash`) simply doesn't render for it anymore, so a pontic
  tooth in the side view is now **completely blank**: no crown, no root,
  no outline, just its column's position between the bridge's anchors.
  The generic x-cross block that would otherwise fire off
  `STATUS_STYLES.bridge_pontic.symbol` is still given an explicit
  `&& !isPontic` exclusion — same idea as the existing `!isProsthesis`
  exclusion right next to it — since a lone X with nothing else drawn
  around it would just look like a stray mark floating in empty space.
  A bridge anchor tooth (plain `crown` status) is unaffected in either
  view — still a normal crown+root, just teal, exactly like any other
  `crown` tooth, since there's no separate status distinguishing the two.

### Canal display (endodontsko zdravljenje)

**Status: built — now an independent field, not a `ToothStatus`.** Two
redesigns down from the original spec, both driven by real feedback rather
than speculation:

1. An early version traced a pulp-chamber-to-apex line through the root,
   red/blue for planned/done. Shipped briefly in the "Cela karta" demo,
   then removed once Monika discussed canal/endo charting with the doctor
   — see the git history around 2026-08-18 if that approach is ever
   revisited. The doctor's actual request, once clarified, was much
   simpler: not a line inside the root at all, just a **symbol in the
   tloris (top-down) view** — a plain circle centered inside the tooth's
   own square, color-coded by treatment stage. No per-canal-count detail
   (a molar's 2–3 real canals aren't distinguished), no side-view geometry
   — a status marker, not an anatomical rendering.
2. That symbol then shipped as three mutually-exclusive `ToothStatus`
   values (`endo`/`endo_planned`/`endo_existing`), same pattern as
   `extracted`/`missing` — but a `ToothStatus` lives in the single
   `surfaces.all` slot along with every *other* status, so a tooth
   couldn't have both a filling and a completed root canal recorded at
   once: applying one wiped out the other. Monika flagged this directly
   ("a filling and endodontic treatment can be on the same tooth"), and it
   was scoped down to *just* this fix (rather than a fully general
   multi-status system) — endo was pulled out into its own independent
   field, `ToothData.endo` (`EndoStage`, types/dental.ts — `'planned' |
   'done' | 'existing'`), exactly mirroring how dental post already works
   (see "Dental post" below): a plain value threaded alongside `surfaces`,
   not competing with it. This also finally gave the long-vestigial
   `ToothData.canal?: boolean` field a real purpose — it predated and was
   meant to be superseded by the original endo statuses but was left
   unused; `endo` replaces it outright (dropped from `ToothData` and from
   `tooth_records`, migration `004_add_endo.sql`).

**Current shape:**
- `endoStage?: EndoStage` is threaded through the component chain exactly
  like `hasPost` — `DentalChart` → `ArchRow` → `TlorisRow` (`endoByFdi`
  prop) → `ToothTopView` (`endoStage` prop) — independent of
  `surfacesByFdi` end to end. `handleSetEndoStage()` in `PatientChart.tsx`
  applies a stage to every distinct tooth in the current selection (same
  dedup pattern as `handleTogglePost`, generalized from boolean to
  stage-equality: sets the stage if any selected tooth doesn't already
  have it, clears it if all of them do — so clicking the same stage twice
  toggles it off).
- **The symbol itself is unchanged** from the original design — the
  `'endo-circle'` `StatusSymbol` type (`ui/StatusSymbol.tsx`), a plain
  unfilled circle using the full passed-in `strokeWidth` (meant to read as
  a bold, deliberate mark, not fine annotation detail). `ToothTopView.tsx`
  still sizes it to **touch the square's own outer edges** — a centered
  `x=1,y=1,width=26,height=26` box (the same one `bridge_pontic`'s cross
  reaches), which for a circle means `r = min(width,height)/2 = 13`
  centered at `(14,14)`, exactly the square's own center — at the same
  **3px** stroke weight as `abrasion`'s own mark (see the line convention
  under "Tlorisni pogled" above, which still lists the endo-circle
  alongside `abrasion` as a deliberate exception to that convention's
  usual 1px). What changed is *where this gets drawn*: no longer inside
  the generic `wholeStyle.symbol` dispatch (that block only ever fires off
  a `ToothStatus`, and endo isn't one anymore) — it's its own
  unconditional block, drawn whenever `endoStage` is set, regardless of
  whatever real `ToothStatus` the tooth also has.
- **Colors**: blue (`DONE_COLOR`) for `done`, grey (`STATUS_COLOR`) for
  `existing` — the same shared colors every other todo/done/existing
  marker on the chart uses (see the caries-dot color note under "Tlorisni
  pogled" above), read via `endoColorFor()` (`statusStyles.ts`) rather
  than a `StatusStyle.symbolColor` entry now that there's no
  `STATUS_STYLES` entry to hang it on. `planned` is still the one
  exception to that unification, for the same reason it always was: its
  circle is a thin 3px stroke, not a solid filled shape like `caries`'s
  own dot, so the shared `TODO_COLOR` hex reads visibly lighter/more
  washed-out there than it does elsewhere — Monika confirmed the
  on-screen color as "#E35656" once she checked it live, and asked for a
  slightly more saturated `#e24e4e` (`ENDO_PLANNED_COLOR`) specifically
  for this one symbol, while confirming every *other* red marker on the
  chart already read correctly.
- **A real tooth, not a prosthetic unit**: setting `endoStage` never skips
  per-surface subdivision — the triangles, occlusal rectangle, and divider
  lines all still render normally, driven entirely by whatever
  `ToothStatus` the tooth has (or doesn't). This is the whole point: a
  tooth can be a plain `crown` (flat teal square, no subdivisions) *and*
  show the endo-circle on top, or have per-surface `caries` dots *and* the
  circle, simultaneously — real coexistence now, not just non-conflicting
  slots that happened not to collide.
- **Whole-tooth only, tloris-view only** — same simplification as before:
  there's no per-surface equivalent of the circle symbol, and no
  side-view rendering at all (the side view's own white-crown fix no
  longer needs a special case for endo either, now that it's never part
  of the `status` prop reaching that logic — see "Healthy-tooth coloring"
  under "Stranski pogled" below).
- **Not reachable from `ToothDetailPanel.tsx`'s chip/picker flow**, same
  as dental post — both independent fields are only editable via the
  direct-click `StatusToolbar` flow (see "Uniform service presentation"
  under "Interaction Design" below), presented as three ordinary grid
  entries (`EndoSwatch.tsx`, one per `EndoStage`) rather than one, since a
  tri-state field can't be a single toggle button the way post is.
- Demoed in `StatusShowcase.tsx` via `MOCK_ENDO` (independent of
  `MOCK_SURFACES` now): tooth 34 (`planned`, red, isolated), tooth 47
  (`done`, blue, isolated), tooth 22 (`existing`, grey, isolated) show all
  three circle colors on their own; teeth 33 and 36 combine the
  endo-circle with per-surface `caries` overrides on every surface — one
  of each endo state — demonstrating the actual coexistence fix this
  change was for: neither tooth has an `all` entry in `MOCK_SURFACES` at
  all anymore, just the per-surface caries dots, with the circle coming
  entirely from `MOCK_ENDO`.

### Dental post (zobni zatiček)

**Status: built.** A post inserted into a treated root canal for
retention — tloris view only, no side-view rendering.

- **Independent of `ToothStatus`, not a new status value.** Unlike every
  status-driven symbol in this file, a post is a plain per-tooth boolean
  (`ToothData.post`), threaded through the component chain the same way
  `bleedingBuccal`/`gumMargin` already are —
  `DentalChart` → `ArchRow` → `QuadrantBlock` → `TlorisRow` (`postByFdi`
  prop) → `ToothTopView` (`hasPost` prop) — rather than folded into
  `surfaces.all`. This was a deliberate choice, not an oversight: a post
  commonly coexists with whatever else is going on for that tooth (a
  crown, caries, an already-completed root canal), the same way BOP or
  gum-margin readings do, so it needed to combine freely with any
  `ToothStatus` — the same reasoning `ToothData.endo` (`EndoStage`) now
  follows too, see "Canal display" above; `post` was the pattern endo was
  built to mirror once endo hit exactly this same competing-for-
  surfaces.all problem for real. `post` is a distinct, still-live concept
  from `endo`, not the same field twice — the two happen to share the same
  threading shape, nothing more. This stays true internally, but per Monika's explicit
  request the *UI* now presents it exactly like a real status wherever
  services are listed — see "Uniform service presentation" under
  "Interaction Design" below.
- **Shape: a hollow (outline-only) triangle**, not a plain line — went
  through two earlier versions before landing here, each per Monika's own
  follow-up correction:
  1. A plain vertical line floating from the tooth's own center (`14,14`)
     outward — the *very* first version, reverted once Monika pointed out
     it should instead touch the square's own outer edge, not float free
     of it.
  2. A line anchored to the edge, extending 10 units *inward* into the
     square — reverted once Monika clarified she meant the *outer* side
     of the square (extending 10 units outward past the edge instead),
     not the inside.
  3. A solid filled triangle at that same footprint (base on the edge,
     tip 10 units out) — reverted in favor of a hollow, outline-only one,
     the current state.
- **Geometry**: base (`DENTAL_POST_BASE_WIDTH`, 6 units — widened from an
  initial 4 per Monika's explicit request) sits directly on the square's
  own outer edge, centered horizontally (`x=14`, the same center every
  other centered symbol in this file uses) — the bottom edge (`y=27`) on
  the lower arch, the top edge (`y=1`) on the upper arch. The tip points
  10 units (`DENTAL_POST_LENGTH`) further in that same direction, **past**
  the square's own boundary, into the surrounding gap — down for lower
  arch, up for upper arch. Drawn as a `<polygon>`, `fill="none"`,
  `stroke={BORDER}`, `strokeWidth={LINE_WIDTH}` — the same default line
  color/weight every other unmarked line in this view uses (see the line
  convention above), since no dedicated color was specified for this
  status.
- **`overflow: visible` on the tooth's own `<svg>`** — required for the
  triangle's tip to actually render past the `viewBox="0 0 28 28"`
  boundary; SVG root elements clip to their own viewBox by default. Every
  *other* shape in this file stays within `[0,28]×[0,28]` regardless, so
  this has no effect on anything but the post.
- **Exposed a real layout bug, since fixed**: the tloris row sits only
  `COLUMN_GAP` (4px) from the pocket-depth row above/below it, and the
  post's ~10-unit outward reach (≈12px on screen after the 1.3× zoom) was
  large enough to visibly overlap the pocket-depth numbers on the lower
  arch, where that gap was only the plain unmodified `gap-1`. It turned
  out the *other* gap was already wider than this one without anyone
  intending it: `BridgeRow` (at the time, always above the tloris squares
  on both arches) always renders its full height (`BRIDGE_ROW_HEIGHT`,
  `4px`) even with no bridge in that quadrant, while nothing occupied the
  equivalent space on the other side — so one gap was already
  `gap-1 + BRIDGE_ROW_HEIGHT` (8px) while the other was just `gap-1`
  (4px), an asymmetry that had gone unnoticed until the post made it
  visible. Fixed in `ArchRow.tsx` with a `<div>` wrapper adding
  `marginTop: BRIDGE_ROW_HEIGHT` to the `PocketDepthRow` on the side
  without `BridgeRow` (`BRIDGE_ROW_HEIGHT` now exported from
  `BridgeRow.tsx` rather than a duplicated magic number), so both gaps
  read as `8px`.
  **This moved when `BridgeRow` gained its `flip` prop** (see "Bridge
  display" above): once the bracket started sitting *below* `TlorisRow`
  on the upper arch instead of above it — to get out of the post's own
  way there, a separate collision this same post feature exposed later —
  the side that needs the spacer flipped too. `ArchRow.tsx` now puts the
  `marginTop`-style spacer on the *top* `PocketDepthRow` for the upper
  arch (`marginBottom`, technically, since it's now the row *before*
  `TlorisRow` that needs the extra push) and keeps it on the *bottom*
  `PocketDepthRow` for the lower arch, unchanged — see "Bridge display"
  above for the fuller reasoning; this section's original fix is still
  correct in spirit, just no longer hardcoded to one row.
- **Demoed on tooth 26** (upper, already `crown` — a post commonly
  supports a crown) **and tooth 36** (lower, already `endoStage: 'done'` +
  caries dots — a post commonly follows a root canal) in `StatusShowcase.tsx`
  (`MOCK_POST`), so both pointing directions are visible in context, each
  a clinically plausible pairing rather than an arbitrary tooth choice.
  **Tooth 13** (upper, `crown` — the anchor of the 13-14-15 bridge) was
  added later specifically to exercise the post/bridge collision fix (see
  "Bridge display" above): it's the one demo tooth where a post and a
  bridge bracket sit in the same quadrant at once, so `BridgeRow`'s `flip`
  is visibly doing its job rather than just working by construction.
- **Schema**: `post boolean default false` added to `tooth_records`
  (`supabase/schema.sql` directly, plus
  `supabase/migrations/003_add_post.sql` for a project that already ran
  the earlier schema) — not yet run on the live project, same as
  migrations 001–002.
- **Workflow note**: every iteration of this feature (line vs. triangle,
  inward vs. outward, filled vs. hollow, base width) was checked on
  localhost and confirmed before being treated as final, per the
  "Visual/design changes get previewed on localhost" rule under "Coding
  Conventions" below — this section only exists in its current, correct
  form because of that back-and-forth, not because the first version
  guessed right.

### Absent tooth: missing / extraction / extracted

**Status: built.** Three related but distinct states for a tooth that
isn't a normal, present, unremarkable tooth — `missing` existed from the
start; `extraction_planned` and a redesigned `extracted` were added
together, per Monika's explicit request, once she needed to distinguish
"still there but about to be pulled" from "already gone."

- **`missing`** (never present — congenitally absent) and **`extracted`**
  (removed) both render as a flat, uniformly light silhouette in both
  views — no crown/root color split, no ink line detail, no outline —
  instead of a normal present tooth's appearance. This is a redesign, not
  the original spec: both statuses used to share one look (a dashed
  dark-outlined square/silhouette with a dark X-cross), which Monika asked
  to soften in stages — first `missing` (a congenitally-absent tooth
  reads as "nothing was ever here," which a bold dashed X overstated),
  then `extracted` to match once the same question came up for it.
  - **Both** fill from `ABSENT_SILHOUETTE_COLOR` (`#EBE9E3`,
    `statusStyles.ts`) — a color lighter than `ROOT_COLOR` (`#D8D5CC`),
    exported so `ToothTopView.tsx`, `ToothSideView.tsx`, and
    `StatusLegend.tsx` all read the same value. In the side view this
    color is applied to the base silhouette layer *and* flows through as
    `crownFill` (since `style.fill` is no longer `'none'` for either
    status), so crown and root paint the same uniform flat tone — not the
    usual white-crown/grey-root split a present tooth gets. The ink
    `detail` layer (root-division lines, fissures, crown contours) is
    skipped entirely for both (`isAbsentSilhouette` in
    `ToothSideView.tsx`) — "just a silhouette," nothing to suggest tooth
    structure that either was never there or is now gone. Neither status
    sets `borderDash` anymore, so the old dashed outline is gone from both
    views; the tloris square additionally drops its outline stroke
    entirely (`stroke="none"`, `isAbsentSilhouette` in `ToothTopView.tsx`)
    rather than falling back to a solid dark border — per Monika's
    explicit request to "just keep the filling."
  - **Only `extracted` shows a symbol** — `STATUS_STYLES.extracted` still
    sets `symbol: 'x-cross'`; `STATUS_STYLES.missing` sets none at all.
    This is the one thing that now tells the two apart: `missing` is
    completely bare (fill only, no border, no symbol — its *position* is
    the only thing marked), while `extracted` gets a 3px X in `DONE_COLOR`
    blue (`#1412A9`) on top of the same silhouette, in both views, marking
    "used to be a tooth here." Because `missing` sets no symbol at all,
    every generic `wholeStyle.symbol`/`style?.symbol` guard that used to
    explicitly exclude `missing` by name (in both view files) could be
    simplified away — it never reaches those blocks in the first place
    now.
- **`extraction_planned`** marks a tooth that's still fully present —
  physically unchanged — but flagged for removal. It deliberately does
  *not* join `extracted`/`missing`'s flat-silhouette treatment: no fill
  override (stays `'none'`, folded into the same white-crown branch as
  `healthy` in `ToothSideView.tsx` — see "Healthy-tooth coloring" under
  "Stranski pogled" above), no border override, no `borderDash`,
  per-surface subdivisions and findings untouched in the tloris view (it's
  intentionally *not* in `FLAT_INNER_STATUSES`) — the only thing that
  marks this status at all is a 3px X-cross over the whole tooth in both
  views, in `TODO_COLOR` red (`#E94949`). A tooth about to be pulled
  hasn't changed physically yet, so — unlike `extracted` — it shouldn't
  look any different from a normal present tooth except for that flag.
- **`extraction_planned`/`extracted` together are a two-state pair**, same
  red-todo/blue-done pattern as `caries`/`caries_treated` and
  the endo-circle's own stages — and, per Monika's explicit request, the exact
  same two shared colors (`TODO_COLOR`/`DONE_COLOR`, see the caries-dot
  color note under "Tlorisni pogled" above for why these are shared
  rather than each pair's own dedicated shade). `missing` isn't part of
  this pair; it has no "done" or "to-do" state of its own, just a fixed
  fact about the tooth.
- **X-cross weight is 3px**, not this view's usual 1px, for both
  `extraction_planned` and `extracted` — the same deliberate exception
  `abrasion`'s mark and the endo-circle already get (see
  the line convention under "Tlorisni pogled" above), per Monika's
  explicit follow-up request once she'd seen the default 1px weight on
  localhost. In `ToothTopView.tsx` this is `isExtractionPair` folded into
  `strokeWidth={isExtractionPair ? 3 : LINE_WIDTH}` in the generic
  `wholeStyle.symbol` block — the endo-circle used to share this same
  ternary (`isEndo || isExtractionPair`) back when it was drawn through
  that block too, but now that it's its own independent, unconditional
  block (see "Canal display" above) it just hardcodes its own `3`
  directly, unrelated to this check. In `ToothSideView.tsx` the x-cross render
  block is *only* ever reached by these two statuses (`prosthesis`/
  `bridge_pontic` are excluded there, and `missing` has no symbol at all),
  so its `EXTRACTION_X_STROKE_WIDTH` applies unconditionally rather than
  needing its own per-status check. Same raw-viewBox-units conversion as
  `abrasion`'s own edge outline (`ABRASION_EDGE_STROKE_WIDTH` — see
  "Stranski pogled" above): the actual value passed is
  `EXTRACTION_X_STROKE_WIDTH * (profile.width / profile.displayWidth)`, so
  a flat "3" (which would render far thinner in this view's own
  large-raw-pixel viewBox) instead reads as a true 3 on-screen px,
  matching the tloris view's weight.
- **Colors are a shared, not dedicated, pair** — `TODO_COLOR` (`#E94949`)
  and `DONE_COLOR` (`#1412A9`, `statusStyles.ts`) are read via each
  status's own `symbolColor` (`ToothTopView.tsx`'s existing
  `wholeStyle.symbolColor ?? wholeStyle.border ?? '#D4537E'` fallback
  chain, unchanged) — but `ToothSideView.tsx`'s own x-cross/
  granuloma-circle render (granuloma-circle has since been removed
  entirely along with the `granuloma` status — see the "Status color
  palette" removal note above; this fix predates that and applied to
  both at the time) previously hardcoded `color={outlineColor}`, never
  reading `symbolColor` at all (never exercised before, since no
  status that showed an x-cross in the side view — `bridge_pontic`,
  `prosthesis` — actually reached that render block, both being excluded
  by `hidesCrown`). Fixed to `color={style?.symbolColor ?? outlineColor}`,
  the same fallback order `ToothTopView.tsx` already used, so `extracted`'s
  blue and `extraction_planned`'s red actually show up in the side view
  instead of silently falling back to the default dark outline color.
- **These colors used to be their own dedicated shades** — an earlier
  version gave `extraction_planned`/`extracted` their own fresh red/blue
  (`#E4572E`/`#1B3A8A`), on the same "distinct clinical marker, not the
  same one repainted" reasoning `caries` and `endo` originally used too.
  Monika's explicit follow-up request reverted this app-wide: red should
  always mean "still needs doing," blue always "done," the same two
  colors everywhere on the chart — see the caries-dot color note under
  "Tlorisni pogled" above for the full reasoning and the other two pairs
  this also touched.
- Demoed in `StatusShowcase.tsx`: `MOCK_SURFACES` sets tooth 18 to
  `extraction_planned` and 28 to `extracted` (both previously-unused upper
  posterior slots) so both states of the pair sit side by side on the
  same wing of the arch; tooth 46 stays `missing`. `StatusLegend.tsx`'s
  `ORDER` array gained `extraction_planned` (placed next to `extracted`/
  `missing`) — the legend needed no other special-casing, since it already
  read `style.fill`/`.symbol`/`.symbolColor` generically.
- **Workflow note**: this feature went through several rounds of
  localhost-confirmed iteration in the order described above — first the
  tloris view's border/X-cross were softened for `missing` alone, then
  extended to `extracted`, then the new `extraction_planned` status and
  the shared-color unification were added on top — each step checked on
  localhost before being treated as final, per the workflow rule under
  "Coding Conventions" below.

### Impacted tooth

**Status: built**, per Monika's explicit request to actually put `impacted`
on the real chart — it had existed in `ToothStatus` and the Legenda from
early on (`STATUS_STYLES.impacted`, still one of the "proposed,
unconfirmed" entries — see "Status color palette" above) but was never
demoed on "Cela karta," only in isolation in `StatusShowcase.tsx`'s old
`EXAMPLES` swatch grid (via `ToothColumn`, tooth 28), which had no
ruler/gumline context to show off any of this — see the `EXAMPLES`/
`ToothColumn` removal note under "Current Status & Next Steps" below for
what happened to that swatch grid since.

- **Tloris (top-down) view: completely blank.** An unerupted tooth has
  nothing to show from directly above — `ToothTopView.tsx` returns a bare
  `<svg viewBox="0 0 28 28" .../>` immediately for `impacted`, before any
  of the normal square/fill/border/symbol/dental-post rendering — not just
  a transparent fill (which is what e.g. `healthy` gets), but no shape at
  all. The 28×28 viewBox is kept only so the returned element still behaves
  like every other tooth's `<svg>` as a layout child inside `TlorisRow`'s
  fixed-size button (the tooth stays selectable — clicking its empty
  square still opens it — it just draws nothing).
- **Side view: the whole tooth is submerged past the gumline, in
  `PerioGraphRow`.** Every ordinary tooth in that row is positioned so its
  own CEJ (`profile.gingivaY`) lands exactly on the row's shared `cejY`
  baseline. An impacted tooth's whole silhouette (crown *and* root
  together, still just one plain translate — not a separate crown/root
  treatment) is shifted one additional full crown-length further in the
  direction *away* from the crown (i.e. deeper into the "root" half of the
  row) — `submergePx = profile.crownLengthMm * PX_PER_MM`, subtracted
  along `coronalSign` (the same sign convention `PerioGraphRow` already
  uses for gumMargin — see "Perio graph" above). Concretely: for the upper
  arch (`coronalSign = 1`, root direction is `-y`, up) this makes `toothY`
  smaller (moves up); for the lower arch (`coronalSign = -1`, root
  direction is `+y`, down) this makes `toothY` larger (moves down) — one
  shared formula, `toothY = cejY - displayGingivaY - coronalSign *
  submergePx`, covers both. The result: the crown, which for a normal
  tooth spans from the CEJ outward, now starts *at* the CEJ and extends
  the same distance again in the root direction — so the whole crown sits
  past where the gumline is, "below the gum line," per Monika's own
  phrasing. `profile.crownLengthMm * PX_PER_MM` converts straight to
  display px with no extra ratio needed (unlike e.g. the abrasion/
  extraction stroke-width conversions elsewhere in this file) because
  `displayHeight` itself is already built from that same
  `totalLengthMm * PX_PER_MM` scale — see `toothProfiles.ts`. The
  silhouette itself (grey fill, dashed border) needed no new styling at
  all — `STATUS_STYLES.impacted` (`fill: '#D8D5CC'`, `borderDash: true`)
  already produces exactly "a silhouette bordered with a dashed line" via
  the existing generic per-status rendering in `ToothSideViewContent`,
  the same `style?.borderDash` path any other dashed-border status
  already goes through; only the *position* needed new logic.
- **The root is clipped exactly at the row's own last horizontal ruler
  line**, per Monika's explicit instruction, rather than being left to run
  further down (or, worse, past the row's own edge). The row's ruler grid
  (`rootZonePx`, and so `svgHeight`/the ruler's own ticks) is sized from
  `maxRootMm` — the tallest *ordinary, non-submerged* root among that
  row's teeth — computed before any impacted tooth's extra
  `submergePx` offset is added, so an impacted tooth's own root
  necessarily runs past whatever that boundary already was.
  `lastRootTickMm = Math.floor(maxRootMm / RULER_STEP_MM) * RULER_STEP_MM`
  is the exact same floor-to-nearest-2mm value the ticks loop already uses
  for its own deepest root-direction tick, so the clip lines up with the
  actual drawn line (not the raw, pre-rounding root length) — and
  `rootLineY = cejY - coronalSign * lastRootTickMm * PX_PER_MM` is one
  formula covering both arches, the same sign-convention trick `toothY`
  above uses.
  **The clip is applied via a plain, untransformed wrapping `<g
  clip-path="...">`, not directly on the tooth's own nested `<svg
  x y width height viewBox>` element.** The first version put
  `clip-path` straight on that nested `<svg>` — which itself carries both
  a translate (from its own `x`/`y`) *and* a scale (from `viewBox` →
  `width`/`height`) — and the root didn't actually stop at the line on
  localhost, exactly the kind of thing the "preview before treating
  anything as final" rule below exists to catch. `clip-path`'s coordinate
  system on an element that *also* carries its own transform is genuinely
  ambiguous across the SVG spec/engines (does the clip rect read in the
  parent's coordinate system, or the element's own post-transform one?);
  wrapping the tooth's `<svg>` in a sibling `<g>` with no transform of its
  own sidesteps the ambiguity entirely — a `<g>` with nothing to transform
  unambiguously shares its parent's coordinate system, so the clip rect
  (defined once per row, in `<defs>`, in that same outer `<svg>`'s own
  coordinates — a `<rect>` spanning from `rootLineY` to the row's crown
  side, sized differently per arch since which side is "past the line" is
  arch-dependent) is guaranteed to line up with the ruler ticks it's meant
  to match.
- **Gumline forced flat (0 recession), regardless of any actual
  `gumMargin` data** — per Monika's explicit instruction ("the gum should
  be at 0"). There's nothing to measure recession against on a tooth
  that's never broken through the gum, so this isn't left to the ordinary
  "no entry = never recorded" convention (which would just as easily show
  a stray real reading if one happened to exist in the data) —
  `PerioGraphRow`'s `gumPoints` construction checks `statuses?.[fdi] ===
  'impacted'` first and substitutes a hard `[0, 0, 0]` before falling back
  to the tooth's own `gumMargin` entry.
- **The REC (gum-margin) number below the tooth is shown too, forced to
  "0"** — per Monika's explicit follow-up request. This is the opposite
  choice from every other "no data = no display" field on this chart
  (pockets, gum margin, BOP): an impacted tooth's recession isn't
  *unmeasured*, it's a known clinical fact ("unerupted, so zero"), so it's
  shown the same way a real `[0, 0, 0]` entry reads for any other tooth —
  a first version instead suppressed the REC label entirely for
  `impacted` (treating it like unmeasured data), which Monika's follow-up
  corrected. It lands in the ordinary `recRowY` position, "past the root
  tips" (see "Perio graph" above) — which, for an impacted tooth, ends up
  sitting close to the clipped root's own stump, reading as "the recession
  number, right where the root would end," not a stray label floating far
  from the tooth.
- **Tloris and side-view logic both key off the same `statuses` map**
  `PerioGraphRow`/`ToothTopView` already receive (`surfaces.all`) — no new
  prop or data-model field, `impacted` is a real `ToothStatus` like any
  other.
- **Demoed** on tooth 48 (`StatusShowcase.tsx`'s `MOCK_SURFACES`) — a real
  third molar, the classic clinically-impacted case — replacing what used
  to be a third `implant` example there (21 and 37 still cover that, one
  per arch, so implant fixture scaling/centering is still shown across two
  different tooth shapes). 48's entries were also removed from
  `MOCK_POCKETS_BUCCAL`/`MOCK_POCKETS_LINGUAL`/`MOCK_GUM_MARGIN` — nothing
  to probe or measure on a tooth that's never erupted, so those rows
  correctly show nothing for it via the ordinary "no entry" convention
  (only the REC number is force-shown, per the bullet above). The old
  isolated `EXAMPLES` swatch grid had separately demoed `impacted` at
  tooth 28 too (via `ToothColumn`, which had no ruler/gumline context at
  all — that demo only showed the tloris-blank + side-view
  dashed-silhouette parts, not the submerge/clip/REC behavior, which is
  why the "Cela karta" demo at 48 was needed in the first place) — moot
  now that both are gone, see the removal note below.
- **Workflow note**: the root-clipping bug above (clip-path applied
  directly to a transformed element, silently not clipping where
  intended) was only caught by checking the actual rendered chart on
  localhost, not from the geometry math alone — the math for `rootLineY`
  itself was correct from the start; only *where* the clip was attached
  in the SVG tree was wrong. Same lesson as the caries-dot inward-shift
  fix and abrasion's crown-edge outline elsewhere in this file: numeric
  verification is a useful sanity check, but a live visual check is what
  actually catches this class of bug.

---

## Interaction Design

**Status: built** (`PatientChart.tsx` + `src/components/ui/ToothDetailPanel.tsx`,
`SurfaceChip.tsx`, `StatusPicker.tsx`, `StatusToolbar.tsx`, `StatusSwatch.tsx`,
`PostSwatch.tsx`), now saving to Supabase via `useVisit.ts` (autosave on a
30s inactivity timer or immediately on sign-out — see "Visit lifecycle"
below for exactly what's real vs. still hardcoded). Two ways to set a
status, both writing through the same underlying functions
(`handleSurfaceStatusChange`/`handleWholeToothStatusChange` in
`PatientChart.tsx`) so they can never disagree:

(A third, entirely separate interaction mode exists for pocket-depth and
gum-margin *numbers* — click-to-focus + type-a-number, not click-to-select
+ pick-a-status — since a full periodontal exam is roughly 200 individual
mm readings, too high-volume for the picker/toolbar pattern below. See
"Perio data entry" under "Perio graph" for the full mechanism; it clears
`selection` and vice versa, so the two modes never mix mid-click.)

### Click on tooth (detail panel)
- Click a tooth → a detail panel opens below the chart, keyed to that FDI
  (`key={selectedFdi}`, so switching teeth remounts it fresh — no leftover
  open-picker state bleeding from one tooth to the next).
- Shows: tooth number + type, a "Cel zob" (whole tooth) control, one chip
  per applicable surface (`TOOTH_META[fdi].surfaces`, ant/post-aware
  labels via `surfaceLabel()` in `toothMeta.ts`), and a notes field.
- Clicking the whole-tooth control or a surface chip opens `StatusPicker`
  inline — a full flat grid of every status (`STATUS_ORDER`,
  `statusStyles.ts`), each with its `StatusSwatch` icon — picking one
  applies immediately (optimistic UI, no confirmation step) and closes the
  picker. Whole-tooth *replaces* that tooth's `SurfaceMap` (`{ all:
  status }`, clearing any per-surface overrides); a single surface pick
  *merges* (touches only that key). If the picked status is one that
  hides per-surface detail entirely (`hidesSurfaceDetail()`,
  `ToothTopView.tsx` — crown, implant, missing, extracted,
  prosthesis_crown, bridge_pontic, prosthesis, impacted), it's redirected
  to the whole-tooth path regardless of which surface was actually
  clicked — setting one of these on a single surface would otherwise
  either do nothing visible, or paint just that one triangle in a flat
  status's color, neither of which is clinically real (Monika's example:
  "Krona should apply to the entire tooth instead of a single surface").
  Chips for a tooth already under a hides-detail whole-tooth status show a
  one-line hint explaining why editing them won't change anything on the
  chart, rather than silently no-opping.
  **`abrasion` redirects to the whole-tooth path too, via a second,
  broader predicate** (`redirectsSurfaceEditToWholeTooth()`,
  `PatientChart.tsx` — `hidesSurfaceDetail() || status === 'abrasion'`),
  not by joining `hidesSurfaceDetail()`'s own set. Its own mark (the red
  incisal-edge line or occlusal-box outline — see "Tlorisni pogled" above)
  reads off `wholeToothStatus` for anterior teeth and the resolved
  OCCLUSAL surface specifically for posterior ones — never any other
  individual surface — so per Monika's report, clicking e.g. a mesial/
  distal/buccal/lingual zone and picking "Abrazija" there had no visible
  effect at all, and even the occlusal zone only worked by coincidence.
  Unlike `hidesSurfaceDetail()`'s own group, though, abrasion does NOT
  hide the tooth's other per-surface detail — the triangles/occlusal
  rectangle still render, just unfilled, and a *different* surface set
  independently afterward (caries on one specific zone, say) still shows
  normally — it just needs the whole tooth set so its own mark reliably
  triggers regardless of which surface(s) were clicked. That's why it
  isn't folded into `hidesSurfaceDetail()` itself: that function is also
  read by the "won't be visible" hint above, which would be a false claim
  for abrasion (other surfaces' own changes *do* stay visible there).

### Direct chart selection (StatusToolbar)
A faster, later addition, built after trying the panel-only flow and
finding it too slow for marking several things at once:
- **Every surface zone is its own click target** — not just the whole
  tooth. `ToothTopView.tsx` wires `onClick`/`pointerEvents: 'all'` onto
  each triangle and the occlusal rectangle (needed because a `fill:
  'none'`/transparent zone doesn't receive pointer events by default in
  SVG), reporting `(surface, event)` up through a shared
  `onTargetClick`/`isTargetSelected` prop pair threaded through
  `TlorisRow` → `ArchRow` → `DentalChart` (the same pass-through pattern
  every other per-tooth data map in this chart already uses). The FDI
  number below each tooth (`NumberRow.tsx`) is the explicit "target the
  whole tooth" affordance — clicking a surface zone can't mean that once
  every zone has its own meaning, so there needed to be a separate control
  for it. Flat/hides-detail teeth (and `impacted`'s blank tloris square)
  report `'all'` from their one whole-square click target, same as
  before.
- **Multi-select**: plain click on a target replaces the current
  selection with just that one; Ctrl/Cmd (or Shift) + click toggles it
  in/out of the existing selection — selected zones/squares get a
  translucent `--tooth-selected`-colored overlay drawn on top, regardless
  of the tooth's own status color underneath.
  **Two more indicators track the same selection at the whole-tooth
  level**, both driven by one shared `isFdiSelected(fdi)` check
  (`PatientChart.tsx` — true if *any* target belonging to that tooth is
  currently selected, regardless of which specific surface): the tloris
  square's own outline (`TlorisRow.tsx`, a rounded `2px solid
  var(--tooth-selected)` border) and the FDI number's own highlight
  (`NumberRow.tsx`, filled background). These two used to be driven by two
  *different* pieces of state — the number by the fine-grained
  `isTargetSelected`, the square by an unrelated, older `selectedFdi`
  (only ever updated by clicking *inside* the square itself, via bubbling
  from a zone's own click, never by clicking the number) — so clicking the
  number to select a new tooth for the toolbar left the *previous* tooth's
  square outline stuck in place, per Monika's explicit bug report ("if I
  click on a tooth in tloris view it gets marked... if I then click on
  another tooth number, this number gets marked, but the previous tooth
  still remains marked in tloris view"). Both now read the same
  `isFdiSelected`, so a plain click anywhere — the number, a surface zone,
  or a flat tooth's whole square — moves both indicators together and
  clears the previous tooth's, every time. `selectedFdi` (still real,
  still drives the detail panel below — see "Click on tooth" above) is no
  longer threaded down into `DentalChart`/`ArchRow`/`TlorisRow` at all,
  since nothing in that tree reads its *value* anymore, only fires it
  upward via `onSelect`.
- **Apply to selection**: `StatusToolbar` (rendered as a sidebar next to
  the chart) shows an always-visible grid of every status, identical in
  spirit to `StatusPicker` — clicking one applies it to every currently
  selected target at once (same merge/whole-tooth-redirect rules as
  above). **The selection is deliberately left untouched afterward** — per
  Monika's explicit request ("apply crown to tooth 21, then — still
  selected, no reselecting — toggle the dental post on it too"), so
  several services can be layered onto the same selected tooth/teeth back
  to back. This is a reversal: every apply action (`handleStatusClick`,
  `handleTogglePost`, `handleSetEndoStage`) used to clear the selection on
  success, matching a "uniform treatment end to end" reasoning at the
  time — reversed once that same uniformity turned out to be exactly what
  made applying several services to one tooth tedious. The selection now
  only ever changes from an actual chart click (replace, or Ctrl/Cmd to
  extend) or an explicit clear — this same `StatusToolbar`'s own "Prekliči
  izbiro" button, or Escape (`PatientChart.tsx`'s own `keydown` listener —
  the first global keyboard handling in this app — guarded so it does
  nothing while focus is in a text input, e.g. the notes textarea).
  **`bridge_pontic` is the one status in this grid that doesn't follow the
  generic apply-to-every-target rule above** — `handleStatusClick`
  special-cases it to `handleCreateBridge()` instead, which needs an
  existing anchor tooth (`crown`/`implant`) in the selection and forms an
  explicit bridge group rather than just painting a status — see "Bridge
  display" for the full mechanism and why it replaced an earlier,
  purely status-driven approach.
- **An earlier version also supported arming a status first** ("pick a
  status, press a lock key, then paint it across repeated clicks without
  re-picking each time" — explicitly requested, "like tools in MS Word")
  — built, then reverted per explicit feedback once tried: the "armed but
  not yet applied" intermediate state was too easy to miss (clicking a
  status with nothing selected just highlighted it, with no obvious sign
  anything had happened), so a click on the chart afterward silently did
  nothing from the user's point of view. Select-then-apply only, going
  forward — not currently planned to revisit.

### Uniform service presentation

**Every service or finding gets exactly one entry, presented identically,
wherever services are listed** — `StatusLegend.tsx`'s Legenda and
`StatusToolbar`'s/`StatusPicker`'s grids alike: one small icon
(`StatusSwatch`, or a dedicated equivalent like `PostSwatch.tsx` for a
field that isn't a real `ToothStatus`) plus one label, in a single
button/row of the same size and shape as everything else next to it. This
applies *regardless of whether the service happens to be a real
`ToothStatus` internally* — per Monika's explicit request, prompted by
`post` (zobni zatiček) originally getting a bespoke two-button "Dodaj" /
"Odstrani" control in `StatusToolbar`, visually inconsistent with every
status's own single click-to-apply button right next to it. `post` is a
plain per-tooth boolean (`ToothData.post`, not part of `SurfaceMap`, kept
separate specifically because it needs to coexist with whatever status a
tooth already has — a post commonly supports an existing crown or follows
a completed root canal), but the UI still presents it as one button with
one icon (`PostSwatch`), positioned inside the exact same grid as every
real status; clicking it toggles post on for every distinct tooth in the
current selection if any lack it, off once all of them already have it
(`handleTogglePost`, `PatientChart.tsx`) — one click, same as a status,
not an add/remove pair. `StatusLegend.tsx` follows the identical rule:
`post` gets its own hand-added row (same pattern the BOP row already
used, since BOP was never a `ToothStatus` either), same icon/size/label
shape as every `STATUS_ORDER`-driven row above it.

**Endodontic treatment (`ToothData.endo`, `EndoStage`) followed the exact
same rule once it was pulled out of `ToothStatus`** — see "Canal display"
above for why. It's the first field this principle had to stretch for: a
tri-state value can't be a single toggle button the way `post`'s boolean
is, so it's presented as **three** grid entries instead of one
(`EndoSwatch.tsx`, parameterized by `EndoStage`, mirroring how
`StatusSwatch` covers many statuses through one component) — but each
entry is still exactly one icon + one label, same size/shape as every
other button next to it, and clicking one still applies immediately with
no extra confirmation step. The rule was never "one field, one button" —
it's "one *value*, one button"; `post` only ever had one value to offer.
`StatusLegend.tsx` mirrors this with three hand-added rows, same pattern
as the `post`/BOP rows.

**Any future non-`ToothStatus` service field must follow this same
rule**: one icon component per distinct value (co-located in
`src/components/ui/`, matching `StatusSwatch`/`PostSwatch`/`EndoSwatch`'s
own size/viewBox convention), one entry per value in both
`StatusLegend.tsx` and `StatusToolbar`/`StatusPicker`'s grids — never a
bespoke multi-control widget (an add/remove pair, a dropdown, etc.), even
if the underlying data model has to stay a separate field (as `post` and
`endo` both do) for good reason.

### Status change flow (current)
1. Click a tooth (panel) or a surface/whole-tooth zone directly (toolbar
   selection) — or several, via Ctrl/Cmd+click.
2. Click a status in the picker/toolbar grid → applies immediately
   (optimistic UI, no confirmation step, no debounce).
3. Autosave to Supabase is **built and confirmed working**, via
   `useVisit.ts` — see "Visit lifecycle" below for the full picture,
   including what's still not built (closing a visit — nothing ever sets
   `visits.closed_at` yet). Every state map this
   step used to describe as local-only (`surfacesByFdi`/`postByFdi`/
   `endoByFdi`/`notesByFdi`, plus the perio-entry state —
   `pocketsBuccalByFdi`/`pocketsLingualByFdi`/`gumMarginByFdi`/
   `bleedingBuccalByFdi`/`bleedingLingualByFdi`) now lives in and is
   persisted by that hook instead of a plain `useState` in
   `PatientChart.tsx` — `bridgeGroupByFdi` is the one exception, still
   local-only `useState` there.

### Visit lifecycle (open/close) and per-tooth history

**Status: fully built and confirmed live — every piece of the design
below is implemented, not just the first slice.** `src/hooks/useVisit.ts`
loads a visit's `tooth_records` on mount and saves back to Supabase —
confirmed live repeatedly (a change made on `PatientChart.tsx`, saved,
survives a sign-out/sign-in round trip, and shows up as a real row in the
Supabase Table Editor). This is the agreed shape reached through direct
discussion about when saving should actually happen, and supersedes the
earlier, vaguer "Two record layers" sketch (`initial_status` +
`visit_entries[]`) with a concrete mechanism built on the schema's own
existing shape, not a new one.

**What's built and confirmed:**
- `useVisit(visitId)` loads every `tooth_records` row for one visit into
  the same per-fdi state shape `PatientChart.tsx` already used locally
  (`surfacesByFdi`/`postByFdi`/`endoByFdi`/pockets/gum-margin/bleeding/
  notes/`bridgeGroupByFdi`), and exposes a `flush()` that upserts every
  tooth that actually changed since the last save back into that visit's
  rows (`onConflict: 'visit_id,tooth_id'`, the unique index from migration
  005) — see the dirty-tracking bullet below for how "actually changed" is
  determined.
- `PatientChart.tsx` calls `flush()` three ways: a 30-second-since-the-
  last-change debounce (the standard React reset-the-timer-in-a-cleanup
  pattern), immediately on clicking "Odjava" (sign out), and immediately
  on "← Nazaj na seznam pacientov" (back to the patient list) — see
  `handleBackClick`/`handleSignOutClick`.
- `App.tsx` now gates `PatientChart` behind a real Supabase Auth session
  (`Login.tsx`/`useAuth.ts`, previously built but unused) instead of the
  `VITE_DEV_PAGE=patient` bypass — signing in for real is now required to
  reach the chart at all. `VITE_DEV_PAGE=showcase` still bypasses auth for
  `StatusShowcase.tsx`, which stays read-only/local-only on purpose.
- Migrations 001–009 are confirmed run on the live project (now the
  dedicated "Dental charting" one — see "Supabase Schema" above), and both
  Monika's and Gregor's Supabase Auth logins are confirmed created and
  working.
- **`bridgeGroupByFdi` now persists too** (`tooth_records.bridge_group_id`,
  migration `006_add_bridge_group.sql`) — confirmed live: a bridge formed
  via "Člen mostu" survives a reload/sign-out-sign-in, same as every other
  field `useVisit.ts` tracks. This closes what used to be the one remaining
  gap in the save pipeline.
- **Real dirty-tracking in `flush()`** — confirmed working: it now diffs
  every field against a `lastSavedRef` snapshot (what was last successfully
  written, or just loaded) and only upserts teeth that actually changed,
  via plain reference (`!==`) checks per field per tooth — safe because
  every setter already replaces a changed tooth's value with a brand new
  object/array rather than mutating one in place, so an untouched tooth's
  reference never changes on its own. Replaces the earlier version, which
  rewrote every tooth with any data at all on every single save.
- **A real patient list (`PatientList.tsx`/`usePatients.ts`) exists**,
  replacing the single hardcoded `TEST_VISIT_ID` this section used to
  describe — see "Patient list" below for the full feature. `useOpenVisit
  (patientId)` resolves which visit a chosen patient's chart should
  actually load/save against — see below, since this resolution rule
  changed once closing was actually built.
- **Closing a visit is fully built.** `useOpenVisit(patientId)` resolves an
  "open" visit as one with no `closed_at` at all — **not** scoped to
  today's date (an earlier version filtered on `.eq('date', today)`, which
  meant a patient's chart silently started a brand-new, empty visit every
  time it was opened on a later calendar day, hiding all previously-entered
  data behind an unrelated fresh visit — caught live, fixed by dropping the
  date filter: as long as nothing has closed a patient's visit, there is
  only ever one open one for them, no matter how many days pass).
  `useVisit.ts` exposes `closeVisit()`, which sets `closed_at`; a visit
  closes on an explicit "leaving this workspace" action (back-to-list,
  sign-out — `handleBackClick`/`handleSignOutClick` in
  `PatientChart.tsx`, both `flush()` then `closeVisit()` before navigating
  away) or a 30-minute inactivity safety-net timer, matching the design
  below exactly.
- **A critical load-query fix this depended on**: `useVisit.ts`'s original
  load effect queried `.eq('visit_id', visitId)` only — this "worked" only
  by accident, because closing was unimplemented at the time (one eternal
  visit per patient, so "this visit's rows" and "this patient's current
  state" were the same set). Once closing became real, a patient's *second*
  visit starts with zero rows of its own, so that same query would have
  made the live chart appear to reset to blank the moment a patient's visit
  actually closed. Fixed before ever shipping live: the load effect now
  queries every one of a patient's `tooth_records` across **all** of their
  visits (`visits!inner(...)`, filtered by `patient_id`, ordered ascending
  by the visit's `created_at`), reducing client-side so each tooth's latest
  row wins — with explicit "delete the field" branches so a later visit's
  *absence* of e.g. `post` correctly clears an earlier visit's `post: true`,
  rather than a naive merge leaving stale data behind.
- **"Zgodovina zdravljenja" (treatment history) is built, in two places**:
  a per-tooth tab (`ToothDetailPanel.tsx`'s "Zgodovina" tab, driven by
  `useToothHistory(patientId, fdi)` — every `tooth_records` row for that
  one tooth across every visit, newest first, each labeled with its date
  and "(trenutni obisk)" if that visit is still open) and a per-patient
  rollup across every tooth (`usePatientHistory(patientId)` — same join
  pattern minus the `tooth_id` filter, grouped by visit instead of by
  tooth; backs Frame 8, "Pretekli termini in storitve," on the real
  Patient Record page — see "Patient Record page" below). Both read the
  same underlying rows through one shared formatter,
  `src/lib/describeToothRecord.ts` (`describeToothRecord(entry, fdi):
  string[]`), so the two views can never disagree about what a given
  `tooth_records` row actually means.
- **Patient-detail/edit view is built** — Frame 2 of the Patient Record
  page (see below), reading/writing every patient field via
  `updatePatient()` (`usePatients.ts`), including two fields added
  specifically for this — `assigned_dentist` ("Izbran terapevt") and
  `internal_record_number` ("Št. interne evidence") — both real, editable
  `patients` columns rather than hardcoded (per Gregor's explicit request:
  "don't like hardcoded solutions," even for a field that today only ever
  has one real value).

**The problem that shaped the design below**: an early proposal was to
save (and log one history entry) every time the selected tooth changes —
click a different tooth, flush whatever changed on the previous one.
Monika rejected this once she walked through her actual workflow: a real
appointment touches many teeth, often revisiting the same one more than
once, and a chart note is naturally written per *visit*, not per
tooth-glance — saving on every tooth switch would fragment one visit's
work into several disconnected history entries for the same tooth. She
also flagged a separate, practical problem with the interaction itself:
"I clicked the wrong service" needs a window to correct a mistake before
anything commits, which argues for saving less eagerly, not more.

**The resolution, now fully implemented as designed — a visit is either
open (still being worked on) or closed (finished, permanent) —
`visits.closed_at`** (migration `005_add_visit_lifecycle.sql`), null while
open:
- Opening a patient's chart resumes their one open visit if one exists, or
  starts a new one if their last one was already closed. There's no
  explicit "start visit" button — opening the chart to work on it *is*
  starting (or resuming) one.
- While a visit is open, a 30-second-since-the-last-change debounce flushes
  whatever's changed to Supabase (the standard React reset-the-timer-in-a-
  cleanup pattern) — a safety net against losing work to a crash or
  interruption, not a "commit," since the visit itself is still open. Every
  flush **updates the same visit's own rows** rather than creating new ones
  (see the unique constraint below) — nothing is fragmented by how many
  times the 30s timer happens to fire during one sitting.
- A visit **closes** — `closed_at` set once, never un-set — on an explicit
  "leaving this workspace" action (back-to-list, sign-out) or a 30-minute
  safety-net inactivity timeout (in case a tab is left open and forgotten),
  whichever happens first. Once closed, its rows are never written to
  again; the next edit anywhere starts a fresh visit.
- **Known limitation, accepted deliberately**: until "close a visit" is
  tied to more real actions (e.g. an explicit "end appointment" button),
  a visit reopened after a long natural pause — hours, not 30-plus
  minutes, but before the safety-net timeout would have fired — could in
  principle still be "the same open visit" rather than a new one, which
  isn't quite right. Accepted rather than blocking all saving on solving
  it perfectly first.

**No separate event-log table — `tooth_records` already has the right
shape.** It's one row *per tooth per visit*, not one shared row per tooth
overall (see the Supabase Schema section above) — that was already true
before this discussion, just not yet exploited. That means:
- **Per-tooth chronological history** (the "Zgodovina zdravljenja" tab
  Monika described — click a tooth, see everything ever done to it, in
  order) is just every `tooth_records` row for that `tooth_id`, joined to
  its visit's `date`, ordered chronologically. No new table, no separate
  event log to keep in sync with the "current" data.
- **The live chart's current state**, per tooth, is that tooth's row from
  the patient's most recent visit that touched it — a tooth untouched
  since three visits ago still shows its status from back then, correctly,
  without needing its own row copied forward into every visit since.
- **The upsert index** — a unique index on `(visit_id, tooth_id)`, added in
  the same migration — is what makes "update this same row on every flush
  while the visit is open" atomic (`supabase.upsert(..., { onConflict:
  'visit_id,tooth_id' })`) instead of requiring a manual
  check-then-insert-or-update round trip.
- **Only teeth actually touched during a visit get a row for it** — a
  delta, not a full 32-tooth snapshot every visit. A tooth nothing
  happened to during a given visit simply has no row for that visit,
  which is exactly right for "what was actually done" history (no
  duplicate rows for teeth nothing happened to) and cheaper to store.

**Gap closed**: `bridgeGroupByFdi` (which teeth are explicitly linked into
one bridge — see "Bridge display" above) now has a column — plain
`bridge_group_id text` on `tooth_records` (migration
`006_add_bridge_group.sql`), not a foreign key, since the group id itself
has no meaning beyond "these rows share the same value." Confirmed working
live: a bridge formed via "Člen mostu" survives a reload.

### Patient list

**Status: built and confirmed working.** `PatientList.tsx` is now the
app's actual landing page after login — `App.tsx` holds a small two-value
`Route` (`{ page: 'list' } | { page: 'chart'; patientId; patientLabel }`)
instead of going straight to `PatientChart`.

- `usePatients()` loads every patient (sorted by last name, then first —
  RLS already scopes this to the signed-in user's own practice, see
  "Multi-tenancy" above, so there's no explicit practice filter to add in
  the query itself), and exposes `createPatient()`/`updatePatient()`.
  Search is a plain client-side filter over that in-memory list
  (`PatientList.tsx`'s own `query` state) — one practice's patient list is
  small enough that a server-side search round trip isn't solving a real
  problem yet.
- "+ Nov pacient" is an inline form, not a separate page: ime/priimek/datum
  rojstva are required (the three columns `patients` itself requires
  not-null); spol, telefon, e-pošta, naslov/poštna št./kraj, and the ZZZS
  health-card number are all optional. Submitting either shows an inline
  error or navigates straight into the new patient's (empty) chart.
- **Telefon** uses `react-phone-number-input` (`defaultCountry="SI"`,
  emits an E.164 string) — checked against the sibling "dental calendar"
  booking app's own intake form first, which uses this exact same
  library/config, so this matches an existing convention rather than
  inventing a new one. Styled via plain CSS in `index.css` under the
  library's own fixed `.PhoneInput`/`.PhoneInputInput`/`.PhoneInputCountry`
  class names (there's no className prop path to the inner pieces),
  matching this app's border/text-color tokens. Unlike the booking app's
  own field, it's deliberately **not** `required` here — a phone number
  there gates an online booking submission; here it's one optional field
  on an already-valid patient record.
- **Št. zdravstvene kartice** is a plain `<input>` constrained to exactly
  9 digits: non-digit characters are stripped on input (not just rejected
  on submit), `maxLength={9}` caps it, and `pattern="\d{9}"` blocks
  submitting a partially-typed number via the browser's own validation.
- **Naslov is split into three fields** — street (+ house number),
  `Poštna št.`, `Kraj` — rather than one free-text line, per Monika's
  explicit request (checked the sibling booking app first; it has no
  address field at all, so there was no convention to match — this split
  is this app's own). Form layout, after two rounds of Monika's own
  cosmetic follow-up requests: Naslov spans the form's full width on its
  own row; the row below splits into the same left-half/right-half every
  other row in this form uses (Ime/Priimek, Datum rojstva/Spol,
  Telefon/E-pošta) — `Št. zdravstvene kartice` takes the right half (lined
  up with Priimek/Spol/E-pošta), with `Poštna št.`/`Kraj` sharing the left
  half between them (lined up with Ime/Datum rojstva/Telefon), since
  neither needs a full half-width field to itself.
- Selecting a patient (or successfully adding one) hands the whole
  `PatientListItem` object (not just `patientId`) up to `App.tsx`, which
  switches `Route` to `{ page: 'chart', patientId, patientLabel, patient }`
  — `PatientChart` itself resolves/creates that patient's own visit via
  `useOpenVisit` (see above) rather than the route carrying a `visitId`
  directly, and renders Frame 2's patient-info fields immediately from
  `patient` with no extra fetch.
- **Patient-detail/edit view is built** — see "Patient Record page" below
  for Frame 2, which replaces this bullet's old "not built" status.

---

### Patient Record page

**Status: built and confirmed live (2026-09-15).** `PatientChart.tsx` was,
until this point, just the interactive chart + a status-toolbar sidebar —
functional, but visually nothing like the richer 8-frame design mocked up
separately in `PatientPageMockup.tsx` (`npm run dev:patient-mockup`, port
5182 — a dev-only design sandbox with zero real data, the same role
`StatusShowcase.tsx` already plays; **not** deleted or replaced by this
work, still useful for iterating on layout in isolation). Gregor asked for
the real, Supabase-backed patient flow to land on that nicer layout instead
of having two disconnected pages.

**Approach**: `PatientChart.tsx` stayed the one real page (same component,
same route) — its `return (...)` was replaced with the mockup's frame
layout, with every frame wired to real data where real data exists, and
copied verbatim (including its own local mock state) where it doesn't. None
of the existing chart/toolbar/perio-entry/autosave logic changed — this was
a JSX/layout port around code that already worked, not a rewrite.

- **Real frames**: Frame 2 (patient info — see "Patient-detail/edit view"
  above), Frame 8 ("Pretekli termini in storitve" — real cross-tooth visit
  history via `usePatientHistory`, see "Visit lifecycle" above), and Frame
  7 (the chart + `StatusToolbar` + a "Storitve po zobeh" tab reading real
  per-tooth history via `useToothHistory`) are all real, backed by the same
  hooks/handlers `PatientChart.tsx` already had.
- **Placeholder frames, deliberately**: the health-questionnaire banner
  (Frame 1), Rentgeni/Fotografije/SMS/E-pošta tabs (Frame 3), and
  Podrobnosti termina/appointment+invoice card (Frame 5) all stay clearly
  fabricated placeholder content — per Gregor's explicit choice, since no
  real questionnaire/imaging/messaging/appointments/billing backend exists
  yet (see "Out of Scope for Phase 1" below). Building any of those for
  real is future work, not an oversight.
- **`ToothDetailPanel` still renders separately below the frame grid**,
  unchanged — a deliberately different, more detailed surface (editable
  chips + picker + notes + its own "Zgodovina" tab) than Frame 7's quick
  read-only "Storitve po zobeh" glance. Both read the same
  `useToothHistory` data underneath via the shared
  `describeToothRecord()` formatter, so they can't disagree; reconciling
  the two into one surface is a separate future decision.
- **`AppNavShell.tsx`** (`src/components/ui/AppNavShell.tsx`) was extracted
  out of the mockup into a shared component both pages import, so the two
  can never visually drift apart. Its `userLabel` prop now shows the
  signed-in user's real practice name (`usePracticeContext()`) on the real
  page — see "Multi-tenancy" above for why this couldn't stay a hardcoded
  `'Monika Goslar'` default once other practices could exist; the mockup's
  own zero-prop usage still falls back to a generic placeholder.
- **A layout regression, caught and fixed**: an early version of this port
  added a standalone title/autosave status row above Frame 1 that the
  mockup never had — ~50px of extra height invisible on a large monitor,
  but enough to tip a 17"-class screen into vertical scroll the mockup
  never had. Caught by Gregor comparing the two side by side; fixed by
  folding the autosave status into the existing back-link row instead of a
  new row of its own. Worth remembering as a class of bug: a port that's
  logically identical can still regress on total page height in a way that
  only shows up at a specific viewport size, not in a quick glance at a
  wide monitor.
- **Responsive breakpoints ported verbatim** from the mockup:
  `grid-cols-1 → sm:grid-cols-2 → min-[1400px]:grid-cols-[minmax(0,1fr)
  _minmax(0,2fr)_minmax(0,1fr)]`, `contents`-dissolving wrappers so a
  frame's children become independent grid items only below 1400px, and a
  chart width cap (`max-[1399px]:max-w-[990px]`) so the chart doesn't
  dominate the page on a 13"-class laptop screen — confirmed live at both
  a 17"-class (~1920px) and 13"-class (~1280px) width.

---

### App Shell — top navigation frame (AppNavShell)

**Status: built and rolled out to every signed-in page (2026-09-16).**
`AppNavShell.tsx` (`src/components/ui/AppNavShell.tsx`) is a fixed two-row
header — a turquoise (`#5CE1E6`) top bar with "Domov"/"CRM" on the left and
the signed-in user's practice name + an Odjava (sign-out) icon button on
the right, then a white submenu row (Koledar / Storitve / Sporočila /
El. pošta / Nastavitve) with one pill highlighted grey (`#C8D1D9`) to show
which section is active — pixel-matched off the original design mockup
Gregor supplied for the Patient Record page (see "Patient Record page"
above for how it was first extracted out of `PatientPageMockup.tsx`).

**Every real page in the signed-in app renders this at the very top, full
width, above its own content** — `PatientList.tsx` (the landing page),
`PatientChart.tsx`, and `Calendar.tsx` all do, per Gregor's explicit
request that the app have one consistent frame rather than each page
inventing its own header/back-link/sign-out button. `PatientPageMockup.tsx`
(the dev-only design sandbox, port 5182) keeps its own zero-prop, fully
inert `<AppNavShell />` — nothing here changes that.

- **`activeSubmenu` prop** (one of the five submenu keys — `'koledar'`,
  `'storitve'`, `'sporocila'`, `'eposta'`, `'nastavitve'` — defaults to
  `'storitve'`) picks which pill renders as the active grey one:
  `'storitve'` for `PatientList.tsx`/`PatientChart.tsx` (the patient-record
  path), `'koledar'` for `Calendar.tsx` (its own section — the native
  scheduling calendar, see "Native scheduling calendar" below — not nested
  under Storitve). A PNG mockup Gregor supplied at one point showed
  "Storitve" highlighted even on the calendar page, which was briefly
  implemented that way before Gregor's explicit correction: that was a
  quirk/inconsistency in the mockup screenshot itself, not the intended
  design — Koledar and Storitve are genuinely separate active states.
  Sporočila/El. pošta/Nastavitve have no real page behind them yet, so
  they're never passed as `activeSubmenu` and stay permanently inert (no
  `onClick` at all).
- **Both "Koledar" and "Storitve" are clickable from wherever they aren't
  already the active pill** — `onNavigateCalendar` fires when
  `activeSubmenu !== 'koledar'`, `onNavigateStoritve` when
  `activeSubmenu !== 'storitve'`; either prop being omitted just leaves
  that pill inert. Only `Calendar.tsx` passes `onNavigateStoritve` (wired
  to its own existing `onBack`, which already returns to the patient list)
  — `PatientList.tsx`/`PatientChart.tsx` have Storitve as their *active*
  pill already, so clicking it there would be a pointless self-navigation,
  same reasoning `Calendar.tsx` itself omits `onNavigateCalendar`.
- **"Domov" (`onNavigateHome`) takes the user back to the patient list**
  from wherever they are — `PatientChart.tsx` wires it to the same
  `handleBackClick` its own "← Nazaj na seznam pacientov" link already
  calls (flushes pending edits, closes the open visit, then navigates), and
  `Calendar.tsx` wires it straight to its existing `onBack` prop.
  `PatientList.tsx` itself is already home, so it doesn't pass this prop —
  clicking "Domov" there is a no-op, same as every other page's inert
  submenu items.
- **`userLabel`** is the signed-in user's real practice name
  (`usePracticeContext()`) on all three real pages — see "Multi-tenancy"
  above for why this can't be a hardcoded name once more than one practice
  can exist. The mockup's zero-prop usage falls back to a generic
  `'Uporabnik'` placeholder, since it has no session/practice to read from.
- **`PatientList.tsx` and `Calendar.tsx` each lost their own bespoke
  header row** (title + inline "Koledar"/"Odjava" buttons on the list;
  title + back-link + "Odjava" button on the calendar) in favor of this
  shared component — each page's own remaining content starts directly
  below it with no back-link/sign-out of its own, since AppNavShell covers
  both. `Calendar.tsx`'s own plain "Koledar" `<h1>` was later removed
  entirely too, once its Day/Week/Month toolbar (Danes/‹/›/date heading)
  took over that role — see "Native scheduling calendar" below.
- **No dedicated design-spec file exists separately from this one** — this
  section (and "Dental Chart — Visual Specification" above, for the chart
  itself) *is* the project's design reference; there's no second `.md` to
  keep in sync.

---

### Native scheduling calendar (Koledar)

**Status: built and live on `localhost:5181` (2026-09-17).** `Calendar.tsx`
is a real Google-Calendar-style Day/Week/Month scheduling calendar, backed
by the `appointments`/`therapists` tables (migrations
`013_add_appointments.sql`/`014_add_therapists.sql`, both confirmed run —
see "Supabase Schema" above), following the exact same multi-tenancy
pattern (flat `practice_id`, `current_practice_id()` RLS) as every other
table — see "Multi-tenancy" above. **This is a completely different thing
from the separate, unrelated Google-Calendar-*backed* public booking widget
documented at `C:\Users\Uporabnik\Documents\Claude code dental calendar`**
(a patient-facing slot picker embedded on the practice's own website,
writing to an actual external Google Calendar) — this section's calendar is
this app's own internal staff-facing scheduling tool, storing appointments
in this app's own Supabase project. The two are not integrated, synced, or
fed from one another in any way; don't conflate them.

- **Status vocabulary** (`src/lib/appointmentStatus.ts`) is the single
  source of truth for every status's label/color/badge treatment, shared by
  both `Calendar.tsx`'s grid chips and `PatientChart.tsx`'s Frame 5
  ("Podrobnosti termina") — the same status can never render two different
  ways depending which page you're looking at it from. Six statuses:
  `scheduled` ("Naročen", default), `sent` ("Poslano" — a confirmation
  request has gone out, awaiting reply; purely staff-set, no real
  notification-sending exists), `confirmed` ("Potrjen"), `completed`
  ("Opravljen"), `cancelled` ("Odpovedan"), `no_show` ("Ni se
  zglasil/-a"). `appointmentBadge()` maps `confirmed` → a tick and
  `cancelled` → a cross, both rendered in the same red (both badges are the
  same color deliberately — shape, not color, is what tells confirmed from
  declined apart, per Gregor's explicit instruction) as a small circular
  badge in a chip's top-right corner. `appointmentChipStyle()` gives `sent`
  a dashed chip border. **`cancelled` used to also render the chip
  blurred/dimmed** — removed per Gregor's explicit request: a declined
  appointment should look like any other chip, marked only by its cross
  badge, not visually degraded.
- **Day view**: one resource column per therapist (plus a trailing
  "Neuvrščeno" column for appointments with no therapist, or with none at
  all if no therapists exist yet) — a multi-chair scheduling layout, not a
  Google-style single overlaid column. **Week view**: one column per
  visible day instead, Monday-first with Saturday/Sunday as the two
  rightmost columns when weekends are shown (`showWeekends` toggle, in the
  "Teden ▾" dropdown) — `startOfWeekIso()`/`weekDayIsos` in `Calendar.tsx`.
  **Month view** (`MonthOverview.tsx`): a lightweight, read-only 7-column
  day-cell grid (also Monday-first) — day number + up to 3 small
  appointment chips + a "+N več" overflow label per cell, click a day to
  jump into Day view. No click-to-create or drag in Month, per the
  confirmed "lightweight" scope.
- **`TimeGrid.tsx`** is the shared hour-grid renderer behind both Day and
  Week (Month uses its own `MonthOverview.tsx` instead). Covers the full
  **00:00–24:00** range (`GRID_START_HOUR`/`GRID_END_HOUR`, widened from an
  initial business-hours-only 07–20 window) inside its own fixed-height,
  internally-scrolling frame — a sticky day/column header row stays pinned
  to the top of an `overflow-auto` body as you scroll through the hours,
  Google-Calendar-style, opening pre-scrolled to 07:00 (`DEFAULT_SCROLL_HOUR`)
  rather than midnight. **The calendar's own outer frame is a fixed
  viewport-driven size, not content-driven** — `Calendar.tsx`'s whole page
  is `h-screen` + `overflow-hidden` (no page-level scroll at all), so the
  calendar area always fills exactly what's left below the header/toolbar
  regardless of which view is showing; switching Day ↔ Week ↔ Month never
  changes the page's own layout dimensions, only what's inside that fixed
  frame. The frame's bottom edge lands exactly `pb-3` (12px) above the
  viewport bottom — there's no pre-existing "100vh minus header, 12px
  margin" convention on the dental-chart page to match here (checked — that
  page uses fixed per-card pixel heights, not viewport arithmetic), so this
  is its own self-contained convention, not a port of an existing one.
  **A past time slot can't be clicked to create an appointment**: clicking
  one calls `onPastSlotClick` instead of opening the create modal, which
  flashes a notice ("Za preteklost ni možno ustvariti termina.") inline in
  the toolbar row itself (between the date heading and the search box, not
  a row of its own) so it never pushes the calendar frame down, auto-
  dismissing after 4s. Past time is also visually shaded (a faint tint) —
  the whole column for an earlier day, just the portion above the red "now"
  line for today.
- **`AppointmentChip.tsx`**: solid therapist-color background (not a light
  tint), patient name (bold) then time range then service, truncated;
  falls back to a neutral grey (`NEUTRAL_COLOR`) when unassigned. Color
  resolution differs by view since a Day column already *is* one
  therapist (`column.accentColor`) but a Week/Month column is a day, not a
  resource — those pass `resolveEventColor` instead, resolving each
  appointment's own `therapistId` against a `therapistColorById` map built
  in `Calendar.tsx`. **Month view's small chips get the same per-therapist
  color too** (a small dot before the patient name) — this was a real gap
  fixed after Day/Week already had it, since `MonthOverview.tsx`'s chips
  originally rendered as a flat, uncolored grey pill.
- **`TherapistPanel.tsx`** ("Terapevti:") — solid-color name chips in a
  wrapping grid, not a checkbox+dot row; clicking a chip toggles that
  therapist hidden (dimmed to 35% opacity) from the calendar. **Shown on
  every view now (Day/Week/Month), not just Day** — and the hide-toggle now
  actually filters Week's/Month's own appointment lists too
  (`isTherapistVisible()` in `Calendar.tsx`), not just Day's per-therapist
  columns, once the panel became visible everywhere. A "+" button opens a
  small modal (name + a fixed 8-color palette, not a raw color picker) to
  add a new therapist (`createTherapist`, `useTherapists.ts`) — editing or
  deleting a therapist isn't built. **The "+" button is a small drawn SVG
  cross, not a text "+" glyph** — a text glyph sits visibly off-center
  inside a circular button in most fonts (its own glyph box isn't
  vertically symmetric the way a drawn cross is); this was a real bug
  Gregor caught and asked to be fixed. **The chip list is its own
  `overflow-y-auto` region** (`min-h-0 flex-1`) inside the panel's fixed-
  height frame, so a 13"-screen practice with many therapists scrolls
  internally instead of spilling the whole panel (and the fixed-height
  calendar frame beside it) past the screen. **The panel's own frame
  stretches (`h-full`/`flex-1`) to reach exactly 12px above `MiniCalendar`**
  sitting below it in the same sidebar column, per Gregor's explicit
  request, rather than sizing to its own content and leaving a gap.
- **`MiniCalendar.tsx`** — a small month-picker widget in the sidebar
  (month navigation, Monday-first day grid, today/selected-day
  highlighting), clicking a date jumps the main calendar there. Its own
  frame sits at the bottom of the sidebar column (`mt-3` under
  TherapistPanel's now-stretched frame), landing level with the main
  calendar frame's own bottom edge — both exactly 12px off the viewport
  bottom, via `items-stretch` on the shared row plus the `pb-3` on the page
  container.
- **`CalendarSearch.tsx`** — a persistent, always-visible search box
  (not a click-to-expand icon) that searches patient names across **every**
  date, not just the visible range (`useAppointmentSearch.ts` — client-side
  filter over the already-loaded patient list, then an `.in(patientIds)`
  appointments query with no date-range filter). Clicking a result jumps
  the calendar to that date in Day view and opens the appointment for
  editing.
- **Create/edit modal (`AppointmentModal` in `Calendar.tsx`)** — one modal
  for both: a patient search-and-pick control (plus an inline "+ Dodaj
  novega pacienta" mini-form) on create, a fixed link to the patient's own
  chart on edit (an appointment's patient isn't meant to change after the
  fact). Date/time/duration, a free-text "Predvidena storitev", a therapist
  `<select>` ("Neuvrščeno" as the null option), status, and notes.
  - **The inline new-patient mini-form now also collects Telefon and
    E-pošta** (both optional, same as Storitve's own form) alongside the
    always-required Ime/Priimek/Datum rojstva — added per Gregor's explicit
    request ("so staff can get in contact with the patient"), using the
    exact same `react-phone-number-input`/`defaultCountry="SI"` component
    and plain `.PhoneInput` CSS (`index.css`) as Storitve's own "+ Nov
    pacient" form (see "Patient list" above), not a separate styling of its
    own.
  - **A new appointment can't be created in the past** — `handleSubmit`
    compares the full `date`+`time` timestamp against `Date.now()` (not
    just the date, so a past *time* on today's date is caught too) and
    blocks with an inline form error if it's already passed; the date
    `<input>` also gets `min={todayDateValue}` in create mode as a UX
    nicety so the browser's own picker won't offer a past day outright.
    **This guard is create-only, deliberately** — editing an existing
    appointment must still allow a past date/time, since that's exactly how
    a past visit gets marked "Opravljen"/"Ni se zglasil/-a" afterward;
    blocking edits would break that.
- **`calendarLayout.ts`**'s `layoutOverlappingEvents()` — a pure,
  React-free column-packing function (sort by start time, cluster-sweep,
  greedy lowest-free-column assignment) shared by Day/Week to lay
  overlapping appointments side-by-side within whichever column
  (therapist, or day) they belong to.
- **View/weekend-visibility persistence** — Day/Week/Month and the "Prikaži
  konce tedna" checkbox are written to `localStorage`
  (`dentalChart.calendarView`/`dentalChart.calendarShowWeekends`) on every
  change and read back on mount, per Gregor's explicit request that
  reopening the calendar later start where the user left off rather than
  always defaulting to Day. Per-browser, not a Supabase column — a UI
  display preference, not practice data; wrapped in try/catch since
  `localStorage` can throw (private browsing), silently falling back to
  the plain defaults (`day`/`true`) either way.
- **A real timezone bug, found and fixed**: `Calendar.tsx`'s own
  `startOfWeekIso()`/`addDays()`/`addMonths()`/`todayIso()` used to build a
  local-midnight `Date` and convert it back to a `"YYYY-MM-DD"` string via
  `` d.toISOString().slice(0, 10) `` — but `toISOString()` converts to UTC
  first, and Slovenia is UTC+1/+2, so local midnight always rolls back to
  the *previous* calendar day in UTC. That single-day shift then compounded
  every time `addDays()` re-parsed an already-shifted string as a fresh
  local midnight and shifted it again — the practical symptom Gregor caught
  live: Week view's whole 7-day range (and the appointment-range query
  built from it) landed 1–2 days early, opening on a Saturday instead of
  the intended Monday. **Fixed by switching to local-getter formatting**
  (`` `${d.getFullYear()}-${...getMonth()+1...}-${...getDate()}` ``, a
  `toDateIso()` helper) instead of the UTC round-trip — the same safe
  pattern `MiniCalendar.tsx`/`MonthOverview.tsx` already used correctly, so
  this was a case of one file not yet matching a convention already
  established elsewhere. **`` .toISOString().slice(0, 10) `` on a
  reconstructed local-midnight `Date` is the specific bug shape to never
  reintroduce anywhere in this codebase** — `TimeGrid.tsx`'s own `todayIso()`
  had a milder form of the same pattern (using `new Date()`, the current
  moment, rather than a reconstructed midnight — only wrong in the local
  00:00–02:00 window) and was fixed the same way while this was being
  chased down; `useOpenVisit.ts` still has that same milder, narrow-window
  form and hasn't been touched, since it's a much smaller blast radius and
  wasn't the bug actually reported.
- **Tenant isolation**: `scripts/verify-tenant-isolation.mjs` was extended
  (per its own comments) with `appointments`/`therapists` cross-account
  checks symmetric to the existing `patients`/`visits`/`tooth_records`
  ones — a second account can't spoof its `practice_id` onto either table
  and can't see the first account's rows. Not re-run and reconfirmed as
  part of this specific pass (this file only documents what's been
  directly verified — don't assume a fresh pass count without actually
  running it).

---

### SMS appointment reminders and consent (Lertify)

**Status: built and confirmed live (2026-09-22).** A real reminder SMS sent
2 days ahead of a real appointment, confirmed by tapping "Pridem" on the
linked page, which flipped that appointment's status to "Potrjen" —
visible on the Patient Record page's Frame 5 and (via the identical
`appointments.status` column) the calendar's own tick badge — with clean,
error-free logs in both `send-appointment-reminders` and
`appointment-confirm`. Sent via **Lertify — the same account/credential as
the sibling "dental calendar" booking-widget project's own SMS reminders**
(`C:\Users\Uporabnik\Documents\Claude code dental calendar`, its own
"SMS appointment reminders (Lertify)" section — this feature mirrors that
one's overall shape, adapted to this app's own stack).

**Architecture differs from the sibling project's in one deliberate way**:
that project has a real Express backend and uses n8n (scheduled workflow +
webhook) to orchestrate sending; this app has no backend server at all, so
the equivalent logic lives entirely in **Supabase Edge Functions**
(`supabase/functions/`) instead — a scheduled one for sending, and public
ones for the two patient-facing confirm pages. Migration
`015_add_sms_reminders.sql` (confirmed run) adds:

- **`patients.sms_consent_status`** (`unknown`/`pending`/`granted`/
  `declined`) + `sms_consent_requested_at`/`sms_consent_responded_at` — the
  fast-lookup fields `send-appointment-reminders` actually checks before
  ever sending a reminder.
- **`patient_sms_consents`** — a durable, append-only audit table (same
  reasoning as the sibling project's own `booking_consents`): `patient_id`,
  `consent_token`, the *exact wording* shown on the confirmation page,
  `requested_at`/`granted_at`. The `patients` columns above are a mutable
  cache of this table's own facts, not the source of truth.
- **`appointment_reminders`** — one row per appointment actually reminded:
  `confirm_token`, `status` (pending/confirmed/declined), `delivery_status`
  (SENT/DELIVERED/FAILED/REJECTED/UNKNOWN/CANCELLED, updated by Lertify's
  own delivery-report callback), `lertify_message_id`. Both new tables
  follow the exact same multi-tenancy pattern as every other table (flat
  `practice_id`, auto-stamp trigger from the parent row, 4 explicit RLS
  policies) — see "Multi-tenancy" above.

**Double opt-in consent, not a single checkbox** — per Gregor's explicit
request, since Koledar-created patients (staff entering someone over the
phone) never see a web form where a consent checkbox could be shown the
way the website booking widget's own form does. A Postgres trigger
(`request_sms_consent_on_phone_change`, `BEFORE INSERT OR UPDATE OF phone
ON patients`) fires the moment a phone is set or changed, and — via
`pg_net` (Supabase's built-in async HTTP extension, so this never blocks
the actual patient save) — calls the `request-sms-consent` Edge Function,
which sends one minimal SMS asking the patient to tap a link with exactly
one button ("Da, želim prejemati SMS opomnike o terminih"). Not clicking
leaves consent at `pending`, never treated as granted. This is the
standard "double opt-in" pattern (the same mechanic behind every email
newsletter signup) — sending one *request-to-opt-in* message doesn't
itself require prior consent, since its only content is the opt-in ask,
not a reminder or marketing. **Revocation**: since Lertify's account can't
receive inbound SMS replies (same limitation the sibling project hit — see
its own CLAUDE.md), there's no way for a patient to text back "STOP." A
manual staff override lives on the Patient Record page instead (a
"Prekliči soglasje"/"Označi kot potrjeno" toggle next to the
phone field's own "SMS opomniki" status badge) —
`usePatients.ts`'s `setSmsConsentStatus()`, kept as its own dedicated
action rather than a field on `updatePatient()`'s generic bag, since it's
a deliberate compliance decision, not a routine text edit. This is a
solid, defensible default, not a substitute for a real compliance sign-off
from whoever handles the practice's own ZVOP-3 obligations.

**The reminder send itself** (`send-appointment-reminders`, a scheduled
Edge Function) targets appointments starting exactly 2 days ahead, at
**14:00 Europe/Ljubljana**, skipping anyone whose consent isn't `granted`
or who has no phone on file. It's invoked **hourly** by `pg_cron`, not once
at a fixed UTC time — 14:00 Ljubljana is 12:00 UTC in summer (CEST) and
13:00 UTC in winter (CET), and `pg_cron` has no timezone awareness, so the
function itself checks the current Ljubljana wall-clock hour and no-ops
23 times a day, only actually running at the 24th. `pg_cron`/`pg_net` both
needed enabling once (`create extension`) — worked on this project's Free
plan without needing to upgrade, worth knowing since Supabase's own docs
suggest `pg_cron` is Pro-plan-only. **Confirm/decline**
(`appointment-confirm`) updates `appointments.status` to `confirmed`/
`cancelled` directly — the calendar's `AppointmentChip` already renders a
tick/cross for those statuses, so no frontend change was needed for
"appears on the appointment card," per Gregor's original request.

**A real, load-bearing platform gotcha, caught live**: Supabase Edge
Functions **deliberately rewrite `text/html` responses to `text/plain`**
on the shared `*.supabase.co` domain — confirmed by directly inspecting
the response headers (`curl -sD -`) after a real patient's phone showed
raw HTML source text instead of a rendered page, and independently
confirmed as a known, intentional platform behavior (not a bug in this
app's code), documented at
[github.com/supabase/supabase#50214](https://github.com/supabase/supabase/issues/50214)
— real HTML from an Edge Function needs the Pro plan plus a custom domain.
**Remember this for any future public-facing page idea in this app**: an
Edge Function can serve JSON (or any non-HTML content type) just fine, but
never a real webpage, unless that's set up. The fix here: `sms-consent-confirm`
and `appointment-confirm` were rewritten to serve **JSON with CORS**
(`Access-Control-Allow-Origin: *`, since the endpoint is already
token-gated — a stricter origin would add no real security) instead of
HTML, and the two actual patient-facing pages became plain static
HTML+JS files on **GitHub Pages** (`docs/sms-consent.html`,
`docs/appointment-confirm.html`, published at
`https://grgor123.github.io/dental-chart/...` — enabled once via repo
Settings → Pages → Deploy from branch → `main` / `/docs`), each just
`fetch()`-ing the corresponding function for data and the confirm action.
The SMS links point at these GitHub Pages URLs, not the Edge Functions'
own URLs.

**Lertify's actual request/response shape was reverse-engineered, not
guessed twice** — an initial attempt based only on the sibling project's
CLAUDE.md prose (`{sender, to, message}` as a flat body, `Authorization:
Bearer` header) came back a `400` with a validation error naming an
`apiKey` field and an `SmsContentDto` conversion failure. Rather than
guess again, the sibling project's own **already-working n8n workflow**
("Dental appointment booking workflow") was read directly via its API
(`N8N_API_KEY` in that project's `credentials.env` — read-only, this
instance is shared with unrelated workflows, never touch anything else on
it) to find its real "Send SMS via Lertify" node config. The actual shape:
auth is a plain **`apiKey` header** (not `Authorization: Bearer`), the
phone number goes in a **`destinations` array** (not a single `to`
string), `message` is an **object** (`{content, isUnicode}`, not a plain
string), and a successful response is `{ messages: [{ messageId }] }` (not
a flat `messageId`/`id`). Message text avoids Slovene diacritics
(`š`/`č`/`ž`) with `isUnicode: false`, matching the sibling workflow's own
convention — keeps a message inside one cheaper GSM-7 SMS segment.

**Delivery status** (`lertify-delivery-webhook`, public, receives
Lertify's own async `{messageId, status}` callback) updates
`appointment_reminders.delivery_status` by matching `lertify_message_id` —
same mechanic as the sibling project's own "Lertify Delivery Report
Webhook" n8n node, verified against that node's real payload shape the
same way as the send request above (this one matched what the sibling
project's CLAUDE.md already documented, no fix needed).

**Setup this depended on, once per project** (not something application
code or a migration can do): a Supabase Vault secret
(`edge_function_service_role_key`, read by the consent-trigger and cron
job to authenticate their own calls to the Edge Functions — never
committed anywhere), the 5 functions deployed via `supabase functions
deploy` (`sms-consent-confirm`/`appointment-confirm`/
`lertify-delivery-webhook` with `--no-verify-jwt`, since those three have
no signed-in caller at all), and `LERTIFY_API_KEY`/`LERTIFY_SENDER` set via
`supabase secrets set` (reusing the sibling project's own credential,
found in its `backend/.env` — not committed there either, and not copied
into this repo).

---

## ZVOP-3 / GDPR Compliance Notes

- Supabase project must be on **EU (Frankfurt)** region
- Row Level Security enabled on all tables (see schema above)
- No patient data in localStorage or URL params
- Audit log: all writes timestamped, never delete — use `is_active = false` flag
- Export: PDF export of patient chart for archiving (Phase 2)
- Backup: Supabase daily backups enabled

---

## Coding Conventions

- **Language**: TypeScript strict. No `any`, no `@ts-ignore`.
- **Components**: Functional only, hooks only. No class components.
- **Naming**: PascalCase for components, camelCase for functions/variables, UPPER_SNAKE for constants.
- **SVG**: All tooth SVGs are inline (not `<img>`). ViewBox always explicit.
- **State**: Local `useState` for UI state. Supabase for persistence. No Redux.
- **Supabase calls**: Always in custom hooks (`useTooth`, `usePatient`, `useVisit`). Never directly in components.
- **Error handling**: Every Supabase call has error state displayed to user.
- **No console.log** in committed code.
- **Commit messages**: `feat:`, `fix:`, `refactor:`, `docs:` prefixes.
- **Visual/design changes get previewed on localhost before being treated
  as final.** Make the code edit, start (or confirm) the Vite dev server
  is running, and hand Monika the localhost URL — wait for her explicit
  confirmation before updating this file's own documentation, marking
  anything done, or moving on to the next change. This isn't optional
  politeness: the caries-dot inward-shift fix (see "Tlorisni pogled"
  above) was first applied to *every* tooth's side zones based on
  geometry math alone, which turned out wrong for posterior teeth (4–8) —
  their side zones are trapezoids, not triangles, and never actually had
  the overlap problem the fix was solving. A live check would have caught
  that immediately; the math alone didn't. Numeric/geometric verification
  (computing centroids, checking overlaps, etc.) is still worth doing as
  a sanity check, but it's a supplement to a real visual check, not a
  substitute for one.

---

## Phase 1 Deliverables (Dental Chart MVP)

- [x] Supabase project setup (EU region, schema applied, RLS enabled) — went
      through a real detour before landing here: an earlier note claimed
      this was "confirmed live" against a project that, once actually
      checked with Monika, turned out to have no dental-chart tables at
      all, then (once tables did turn up) turned out to be **shared with a
      separate, unrelated appointment-scheduling/consent-storage app**
      (`booking_consents`/`sms_reminders` — documented at
      `C:\Users\Uporabnik\Documents\Claude code dental calendar`, a
      different conversation this session has no memory of), whose
      `patients`/`visits`/`tooth_records`/`treatment_entries` tables
      already existed but only in `schema.sql`'s ORIGINAL, very first
      shape — none of migrations 001–005 had ever actually been run.
      Migrations 001–005 were run to catch that project up, **then Monika
      decided to split the dental chart into its own dedicated Supabase
      project entirely** ("Dental charting") once the shared setup's real
      risk became clear: that other app's backend holds a Supabase
      **service-role key** (bypasses RLS entirely), which could reach this
      app's clinical data too, not just its own two tables. `schema.sql`
      (already including everything through migration 005) was run
      directly against the new, genuinely empty project — no migrations
      needed there. The `migrations/` folder and the history above stay in
      the repo for reference; neither describes this app's actual database
      going forward.
- [x] Auth: single user login (Monika) via Supabase Auth email/password —
      `Login.tsx` + `useAuth.ts` were already built and functional, and are
      wired as the app's actual entry point (`App.tsx` no longer bypasses
      auth for `PatientChart` — see "Visit lifecycle" above). Re-created in
      the new dedicated project once the split above happened (the old
      project's user doesn't carry over) — two accounts confirmed created
      there, `goslar.monika@gmail.com` and `gregor.goslar@gmail.com`, with
      a confirmed real sign-in on localhost.
- [x] Patient list page (search by name) — `PatientList.tsx`/`usePatients.ts`,
      confirmed working; client-side search over every patient, plus an
      inline "+ Nov pacient" form (ime/priimek/datum rojstva required; spol
      restricted to M/F only, telefon/e-pošta/naslov+poštna
      št.+kraj/ZZZS health-card number all optional) — see "Patient list"
      above for the full feature, including why phone/address were built
      the way they were. Patient-detail/edit view now exists too (Frame 2
      of the Patient Record page — see "Patient Record page" above).
- [x] Patient chart page with full FDI dental chart — `PatientChart.tsx`
      renders the real `DentalChart` against a real chosen patient now,
      resolving/creating that patient's own visit via `useOpenVisit` (see
      "Visit lifecycle" above) instead of one hardcoded test visit
- [x] Tlorisni pogled — all 32 teeth, correct surfaces, click to edit —
      rendering, per-surface status fill, tooth selection, and a working
      editor (`ToothDetailPanel`/`StatusPicker`, plus the direct-chart
      `StatusToolbar` multi-select flow) are all done — see "Interaction
      Design" above; now saved to Supabase, `bridgeGroupByFdi` included
      (see "Visit lifecycle" above)
- [x] Stranski pogled — anatomic profiles, pocket depths, canals —
      profiles + a full perio graph (pocket depth, gum margin) are done
      and go well beyond the original spec (see "Perio graph" above); PD/
      REC entry itself (click-to-focus + type-a-number, BOP/sign toggles)
      is also built — see "Perio data entry" above — not just read-only
      display anymore; endodontic treatment now has a tloris-view symbol
      driven by an independent `EndoStage` field (blue/red/grey circle —
      see "Canal display" above), the doctor's actual final spec for the
      symbol itself, after an earlier root-canal-line idea was tried and
      removed, and then a later architecture change pulled it out of
      `ToothStatus` entirely so it can coexist with any other status; no
      side-view canal/root geometry is shown, by design
- [x] Status color fill per surface
- [x] Detail panel on tooth click — see "Interaction Design" above for the full
      current interaction (a click-to-edit panel, plus a direct-click
      multi-select toolbar layered on top); now saved to Supabase, same as
      every other status-setting path on this page
- [x] Save tooth status to Supabase — built and confirmed working
      (`useVisit.ts`, autosave on a 30s inactivity timer, immediately on
      sign-out/back-to-list, or a 30-minute inactivity safety net), including
      bridges and real dirty-tracking (only actually-changed teeth get
      written, not every tooth with any data) against a real, per-patient,
      resolved-or-created visit that now actually closes too — see "Visit
      lifecycle" above
- [x] Visit history toggle (initial vs visit records) — built: a per-tooth
      "Zgodovina" tab and a per-patient cross-tooth rollup (Frame 8), both
      reading real Supabase data through one shared formatter — see "Visit
      lifecycle" above
- [ ] Basic print view (chart only, A4) — not started

## Out of Scope for Phase 1
- eZdravje / ZZZS integration
- Billing / invoicing
- ~~Appointment booking~~ — **built**, see "Native scheduling calendar
  (Koledar)" above. A separate, unrelated Google-Calendar-*backed* public
  booking widget also exists at
  `C:\Users\Uporabnik\Documents\Claude code dental calendar` (embeddable on
  the practice's own website) — the two remain independent projects, not
  integrated or synced with each other in any way.
- Mlečni zobje (primary teeth — 5x/6x/7x/8x series)
- Periodontogram as separate full-screen view
- SMS/email reminders
- Multiple staff logins *within* one practice — `practice_members`' schema
  already supports it (a `role` column, a composite key allowing >1 member
  per practice — see "Multi-tenancy" above), but no invite-flow UI exists.
  **Multiple separate practices** (multi-tenancy) is a different concern
  and IS built — see "Multi-tenancy" above; don't confuse the two.

---

## Current Status & Next Steps

The React app is real and running (not a prototype) —
[`design/tooth-chart-prototype/`](design/tooth-chart-prototype/) was the
pre-React visual-iteration tool and is now historical reference only;
nothing there is ported live anymore, everything described above is the
actual `src/` implementation. In rough build order, what's done and what's
next:

**Done:**
- Full 32-tooth chart (tlorisni + stranski pogled), real anatomical
  proportions, status colors/symbols, per-surface fill, tooth selection
- Full perio graph: CEJ-aligned mm ruler, gumline, dual-surface pocket
  depth, gum-margin recession, bleeding on probing (BOP) — see "Perio
  graph" above
- Implant fixture rendering (two-tone screw + abutment, fixed real-world
  length, centered on the crown's own true midpoint) replacing the traced
  root for `implant` status — see "Stranski pogled" above
- Bridge display: bracket (`BridgeRow`) over an explicitly-created bridge
  group (`bridgeGroupByFdi`), anchored on a natural crown or an implant —
  only ONE anchor needs to already exist, a cantilever bridge is a valid
  case — pontic drawn as a solid-outline square with an X-cross (same dark
  color as every other tooth's outline) in the tloris view and completely
  blank (no crown, root, or outline) in the side view; the bracket flips
  to sit below `TlorisRow` on the upper arch (`BridgeRow`'s `flip` prop)
  so it no longer collides with the dental post there — see "Bridge
  display" above
- Prosthesis (removable-denture) tooth status: circle-in-place-of-square
  rendering in the tloris view, adjacent teeth linked with a connector
  line (including across the arch midline) — see "Tlorisni pogled" above;
  `prosthesis_crown` extends the same connector to natural crowned teeth
  anchoring the same prosthesis, rendered as a completely ordinary crown
- Endodontic treatment symbol: blue/red/grey circle-in-square in the
  tloris view, the doctor's final spec for the mark itself after an
  earlier root-canal-line idea was tried and removed — now driven by an
  independent `EndoStage` field (`ToothData.endo`), not a `ToothStatus`,
  after a later change so it can coexist with any other status on the same
  tooth (a filling and a completed root canal at once, say) — see "Canal
  display" above
- Caries marker: a per-surface red/blue dot (`caries`/`caries_treated`),
  not a flat fill — the one status pair in the whole chart that marks
  individual surfaces rather than only the whole tooth — see "Tlorisni
  pogled" above
- Dental post (zobni zatiček): a hollow triangle touching the tloris
  square's own outer edge and pointing outward, independent of
  `ToothStatus` (a plain per-tooth boolean, `ToothData.post`, threaded
  like bleeding/gum-margin data) — see "Dental post" above
- Absent-tooth family: `missing`/`extracted` render as a flat, uniformly
  light silhouette (no crown/root split, no ink detail, no outline) in
  both views, `extracted` alone marked with a 3px blue X;
  `extraction_planned` (new) marks an otherwise-untouched present tooth
  with a 3px red X — see "Absent tooth: missing / extraction / extracted"
  above
- Unified todo/done/existing colors: every such marker on the chart
  (caries/caries_treated, the endo-circle's own stages,
  extraction_planned/extracted, overlay_planned/overlay/overlay_existing,
  fissure sealant's own three stages) shares one red (`TODO_COLOR`,
  `#E94949`), one blue (`DONE_COLOR`, `#1412A9`), and one grey
  (`STATUS_COLOR`, `#8a8f94`) instead of each feature's own dedicated
  shade — see the caries-dot color note under "Tlorisni pogled" above. The
  third color (grey, "pre-existing/historical") was added after the
  original red/blue unification, extending the missing/extraction
  "status vs. to-be-done vs. done" pattern to `endo`, `overlay`, fissure
  sealant, and — after an initial round leaving it out in favor of
  `filling`'s own separate flat fill — `caries`/`filling` too, once
  `filling` itself was converted to the same per-surface grey-dot
  mechanism (see the "Status color palette" caries/caries_treated/filling
  relabeling note above).
- Fissure sealant (zalitje fisur, `sealant_planned`/`sealant`/
  `sealant_existing`): a small tilde drawn in the same shared row as the
  bridge bracket (`BridgeRow.tsx`), both centered on the true midpoint of
  the gap between the tloris squares and the pocket-depth numbers row — a
  real three-state `ToothStatus` set now, same shape as `overlay_planned`/
  `overlay`/`overlay_existing`, converted from an earlier independent field
  once Monika's clinical correction ruled out the "needs to combine with
  any status" premise that field existed for — see "Bridge display,
  fissure sealant, and overlay" above
- Overlay (`overlay_planned`/`overlay`/`overlay_existing`): a red/blue/
  grey "[" -shaped cap that wraps the tloris square's own edge (long bar
  flush against the edge, short ends bleeding onto the tooth's own face),
  drawn in the same `BridgeRow` row as the bracket/tilde — a real
  three-status `ToothStatus` set, sharing `TODO_COLOR`/`DONE_COLOR`/
  `STATUS_COLOR` with every other such marker on the chart — see "Bridge
  display, fissure sealant, and overlay" above
- Impacted tooth (`impacted`): blank in the tloris view, submerged past
  the gumline in the side view (whole silhouette shifted one crown-length
  into the root direction) with its root clipped at the row's own last
  ruler line and its gumline/REC number forced flat — demoed on tooth 48
  (a real third molar) in "Cela karta" — see "Impacted tooth" above
- Bridge creation rebuilt from the ground up as an **explicit** action —
  select an existing anchor (crown/implant) together with the teeth that
  should become its pontics, then click "Člen mostu" (`handleCreateBridge`,
  `PatientChart.tsx`) — replacing three earlier rounds of purely
  status-driven bracket *inference* (loose any-adjacent-run, strict
  both-ends-anchored, strict matching-anchor-type), all of which kept
  failing in one of two opposite ways: drawing nothing for a
  not-yet-closed bridge ("looks broken"), or silently welding an unrelated
  neighboring crown/implant into a bridge nobody meant to form (Monika's
  teeth-22/24-next-to-implant-21 report). Only one anchor needs to already
  exist in the selection — a cantilever bridge needs no special handling —
  and a failed attempt (no anchor in the selection, too few teeth, spans a
  quadrant boundary) now shows a specific `bridgeMessage` instead of doing
  nothing silently — see "Bridge display, fissure sealant, and overlay"
  above for the full mechanism and history
- Pocket-depth / gum-margin **entry** built: click a probing point, type a
  digit, auto-advance to the next one; the same point doubles as a
  bleeding-on-probing/sign toggle on a second click, or via Shift+digit in
  one keystroke — see "Perio data entry" above. Previously the perio graph
  only ever rendered from static demo props; `PatientChart.tsx` didn't
  even pass pocket/gum-margin/bleeding data into the chart at all
- Applying a status/post/endo-stage/bridge from `StatusToolbar` no longer
  clears the chart selection afterward — per Monika's explicit request, so
  several services can be layered onto the same selected tooth/teeth
  without reselecting between each one; the selection now only changes
  from an actual chart click or an explicit clear (button/Escape) — see
  "Direct chart selection" above
- `abrasion` applied by clicking an individual surface (rather than the
  whole tooth) now redirects to the whole-tooth path, the same way
  crown/implant/etc. already did — its own mark only ever read off the
  whole tooth or the occlusal surface specifically, so most per-surface
  clicks previously had no visible effect at all — see
  `redirectsSurfaceEditToWholeTooth()` under "Interaction Design" above
- Tloris square outline / FDI number highlight unified under one shared
  `isFdiSelected(fdi)` check (`PatientChart.tsx`) instead of two
  independent pieces of state — fixes a desync Monika caught (selecting a
  tooth via its FDI number left the *previous* tooth's tloris square still
  outlined) — see "Direct chart selection" above
- Status cleanup pass, per Monika's explicit request while reviewing the
  Legenda: `bridge_anchor` removed (a bridge anchor is just a plain
  `crown` now — `isAnchorStatus()` in `BridgeRow.tsx` checks
  `crown`/`implant`); `planned` removed as redundant with
  `endo_planned`;
  `granuloma`/`diastema` removed outright (along with the
  `'granuloma-circle'` `StatusSymbol` type and its dead-code
  `rootTipY`/`tipBox` locals in `ToothSideView.tsx`); `caries` relabeled
  "Karies / poka," `caries_treated` relabeled "Plomba," and `filling`
  converted from a flat white fill to a grey per-surface dot (relabeled
  "Plomba (obstoječa)"), joining the same `cariesDotColor()` mechanism —
  see "Status color palette" above for the full reasoning behind each.
  `StatusLegend.tsx`'s `ORDER` trimmed to match, plus `prosthesis_crown`
  dropped from the legend specifically (still a live status/feature,
  just redundant-looking there — see its own color-table note above) and
  `missing`/`extracted` swatches losing their stale border to match the
  real chart's own borderless treatment. `root_only` ("Samo korenina") was
  first dropped from just the same `ORDER` list, per Monika's explicit
  follow-up request, then later removed from `ToothStatus` entirely (same
  shape as `diastema`'s removal above — no special-case rendering logic of
  its own to unwind) once she asked to drop the status altogether, not
  just hide it from the Legenda — see the `root_only` removal note above.
- **"Primeri — cel zob" removed from `StatusShowcase.tsx` entirely**, per
  Monika's explicit request — the `EXAMPLES` array (one FDI per status,
  rendered via the standalone `ToothColumn` component) and its whole JSX
  section. She flagged the examples there as "not accurate" — `EXAMPLES`
  was always a completely independent set of FDI→status assignments from
  "Cela karta"'s own `MOCK_SURFACES`, so the same tooth number could (and
  did) show a different status in each section on the same page — e.g.
  tooth 48 was `impacted` in Cela karta but `implant` in Primeri, tooth 28
  was `extracted` in Cela karta but `impacted` in Primeri. Nothing was
  actually broken; the two sections were just never meant to represent the
  same patient, but that read as inconsistent side by side. Same reasoning
  and same shape as the earlier "PRIMERI - PO PLOSKVAH" (`SURFACE_TESTS`)
  removal above — a flat, hand-maintained list with no logic connecting it
  to the real chart data. `ToothColumn.tsx` itself was deleted too, not
  just its usage — `EXAMPLES` was its only remaining caller anywhere in
  the app (it was "not used by the real chart anymore," per its own
  since-removed comment in the Project Structure listing above — kept
  purely for this one demo, so once the demo went, the component was
  fully dead code, not a maintained fallback). The Legenda (`StatusLegend`)
  is unaffected and still covers every status/color/symbol individually,
  which was the part of Primeri actually worth keeping.
- Supabase project's 5 migrations run and confirmed against what turned out
  to be a project shared with a separate, unrelated appointment-scheduling/
  consent-storage app — then, once that sharing's real risk (that app's
  backend holds a service-role key, which bypasses RLS project-wide) became
  clear, **split into its own brand-new, dedicated Supabase project**
  ("Dental charting"), with `schema.sql` run fresh there instead — see the
  corrected "Supabase project setup" checkbox above. `.env`/`.env.patient`
  repointed at the new project (URL + anon key); the database password is
  also kept in `.env` under `SUPABASE_DB_PASSWORD`, unused by the app
  itself (never wired into `src/lib/supabase.ts`, which only needs the URL
  + anon key), stored purely for reference. Monika's Auth login re-created
  in the new project (`goslar.monika@gmail.com`, plus
  `gregor.goslar@gmail.com`), confirmed working; `TEST_VISIT_ID`
  (`PatientChart.tsx`) re-seeded there too — its value is no longer the
  same visit named earlier in this file's own history. **Cleanup
  confirmed**: the dental chart's now-orphaned `patients`/`visits`/
  `tooth_records`/`treatment_entries` tables were dropped from the old,
  shared project (`booking_consents`/`sms_reminders` untouched, unaffected)
  — that project is now purely the appointment-scheduling/consent-storage
  app's own, with nothing left over from this one
- `App.tsx` flipped off the `VITE_DEV_PAGE=patient` bypass onto the real
  session-gated login flow — `StatusShowcase` keeps its own separate
  `VITE_DEV_PAGE=showcase` bypass, unaffected
- **First working save/load pipeline to Supabase** (`src/hooks/useVisit.ts`)
  — confirmed live by Monika: a change made on the chart survives sign-out/
  sign-in, visible as a real row in the Supabase Table Editor. Autosaves
  ~30s after the last change, or immediately on sign-out — see "Visit
  lifecycle" above for the full reasoning (why not save-per-tooth-switch)
  and exactly what's still hardcoded/simplified in this first version (one
  fixed test visit, no visit resume/close logic yet)
- `bridgeGroupByFdi` persistence added (`tooth_records.bridge_group_id`,
  migration `006_add_bridge_group.sql`) — confirmed live: a bridge formed
  via "Člen mostu" now survives a reload, closing what had been the one
  field the save pipeline above didn't yet cover
- Real dirty-tracking added to `useVisit.ts`'s `flush()` — confirmed
  working: a `lastSavedRef` snapshot (what was last written, or just
  loaded) is diffed per field per tooth via plain reference checks, so a
  save now only writes teeth that actually changed, not every tooth with
  any data at all
- Upper arch's `tnum` row moved from the bottom of its stack to the very
  top, above the side-view teeth (`QuadrantBlock` in `ArchRow.tsx`), per
  Monika's explicit request — the upper and lower arch stacks now mirror
  each other exactly, top to bottom — see "Layout per quadrant" above
- **Patient list built** (`PatientList.tsx`/`usePatients.ts`) — confirmed
  working, replacing the single hardcoded `TEST_VISIT_ID` `PatientChart.tsx`
  used to always load. A new `useOpenVisit(patientId)` hook resolves which
  visit a chosen patient's chart loads/saves against (today's still-open
  one if it exists, otherwise a freshly created one) — see "Patient list"
  and "Visit lifecycle" above for the full picture, including what this
  narrower, date-scoped resolution does and doesn't cover (closing a visit
  is still not built at all).
- **Patient record narrowed to just M/F** — per Monika's explicit request
  ("I do not admit other genders"), `Patient['sex']` dropped `'other'`
  entirely; a patient with nothing recorded yet is `null`, not a third
  gender value. Confirmed working, migration `007_restrict_sex_to_mf.sql`
  run on the live project.
- **Four new patient fields added**: `phone`, `email`, `address`,
  `healthCardNumber` (št. zdravstvene kartice / ZZZS, for future
  eZdravje/ZZZS use only) — per Gregor's explicit request that these were
  missing. `address` was then split further into `address` (street),
  `postalCode`, `city`, again per Monika's explicit request. All confirmed
  working; migrations `008_add_patient_contact_fields.sql` and
  `009_split_address_fields.sql` run on the live project. See "Patient
  list" above for the full feature, including the phone input (matched to
  the sibling "dental calendar" app's own `react-phone-number-input`
  usage) and the health-card number's 9-digit input constraint.
- **Native scheduling calendar (Koledar) built** — a real Google-Calendar-
  style Day/Week/Month calendar (`Calendar.tsx`), therapist resource
  columns, a fixed-height 24-hour scrollable time grid, solid-color
  status-badged appointment chips, cross-date patient search, inline
  new-patient creation (now with phone/email), and past-appointment
  prevention — migrations `013_add_appointments.sql`/
  `014_add_therapists.sql` confirmed run. See "Native scheduling calendar
  (Koledar)" above for the full feature, including a real timezone bug
  (Week view opening on the wrong day) that was found and fixed along the
  way.
- **SMS appointment reminders + consent built, via Lertify** — a real
  reminder sent 2 days ahead of a real appointment and confirmed live
  (2026-09-22): double opt-in consent (a Postgres trigger + Supabase Edge
  Function sends a one-button SMS the moment a phone is set), a daily
  reminder send (Edge Function + `pg_cron`, migration
  `015_add_sms_reminders.sql`), and confirm/decline pages hosted on GitHub
  Pages talking to the functions as JSON (Supabase Edge Functions can't
  serve real HTML on the shared domain — see "SMS appointment reminders
  and consent (Lertify)" above for that gotcha and the full feature).

**Not started:**
1. Print view (chart only, A4)
2. Everything past Phase 1: CRM features, invoicing, appointment
   integration with the separate calendar app, staff-invite UI for
   `practice_members`, self-serve practice signup — see "Multi-tenancy" and
   "Out of Scope for Phase 1" above

---

*Last updated: 2026-09-22 (SMS appointment reminders + consent built and
confirmed live via a real send/confirm round trip — see "SMS appointment
reminders and consent (Lertify)" above for the full feature: double
opt-in consent (a phone-change trigger + Edge Function sends a one-button
SMS before any reminder ever goes out), a daily 14:00-Ljubljana reminder
send 2 days ahead of each appointment (Supabase Edge Functions + pg_cron,
DST-safe via an hourly self-gating check rather than a fixed UTC cron
time), and confirm/decline updating `appointments.status` directly so the
calendar's own tick/cross badges pick it up with no frontend change.
Same Lertify account/credential as the sibling "dental calendar" project;
its exact request shape (an `apiKey` header, a `destinations` array, a
`message` object, not the flat shape the docs alone suggested) was
reverse-engineered from that project's own live n8n workflow after an
initial guess came back a 400. Also caught live: Supabase Edge Functions
deliberately rewrite `text/html` to `text/plain` on the shared
*.supabase.co domain (a real, documented platform restriction, not a bug)
— worth remembering for any future public-facing page in this app — so
the two patient-facing confirm pages ended up as static files on GitHub
Pages instead, talking to the functions as JSON with CORS.)*

*Previous entry: 2026-09-17 (native scheduling calendar built and live — see
"Native scheduling calendar (Koledar)" above for the full feature: a real
Google-Calendar-style Day/Week/Month calendar on `appointments`/
`therapists` tables (migrations 013/014, same multi-tenancy pattern as
every other table), therapist resource columns in Day view, a fixed-height
00:00-24:00 scrollable time grid whose own outer dimensions stay constant
across all three views, solid-color status-badged appointment chips
(tick/cross badges, dashed for "sent", cancelled no longer blurred per
Gregor's explicit request), a persistent cross-date patient search, a
sidebar Terapevti panel now shown on every view with its own scrollable
overflow and its frame stretched to sit 12px above MiniCalendar, and
inline new-patient creation (now collecting phone/email too, matching
Storitve's own form). Past appointments can no longer be created — blocked
both at slot-click (no modal opens, a toolbar-inline notice flashes
instead) and at submit time (full timestamp compared against now, not just
the date) — editing an already-past appointment is untouched, since that's
how a past visit gets marked "Opravljen"/"Ni se zglasil/-a" afterward. A
real timezone bug was found and fixed along the way:
`` d.toISOString().slice(0, 10) `` on a reconstructed local-midnight `Date`
rolls back a day for any UTC+ timezone (Slovenia always is), which
compounded across every `addDays()` call built on it and landed Week
view's whole range 1-2 days early — fixed by switching to local-getter
date-string formatting, the same safe pattern `MiniCalendar.tsx`/
`MonthOverview.tsx` already used. `AppNavShell.tsx` also gained a
`onNavigateStoritve` prop so "Storitve" is clickable from `Calendar.tsx`
too, symmetric to "Koledar" already being clickable everywhere else. This
native calendar is a completely separate, unrelated thing from the
external Google-Calendar-*backed* public booking widget documented at
`C:\Users\Uporabnik\Documents\Claude code dental calendar` — don't conflate
the two.)*

*Previous entry: 2026-09-15 (multi-tenancy foundation built and confirmed
live — see "Multi-tenancy" above for the full design: `practices`/
`practice_members` tables, a `current_practice_id()` RLS helper, flat
`practice_id` on every table with auto-stamp triggers on the three child
tables, a signup-provisioning trigger on `auth.users`, and real
per-practice RLS replacing the old "any authenticated user sees
everything" policy. Verified against the live project with a throwaway
second account: 7/7 isolation assertions passed
(`scripts/verify-tenant-isolation.mjs`), plus a manual UI pass confirming
each account only ever sees its own patients. Same day, earlier: the
Patient Record page port confirmed live — `PatientChart.tsx`'s plain
chart+toolbar layout replaced with the full 8-frame design (patient info,
visit history, chart+toolbar+Storitve po zobeh, placeholder
appointment/imaging/messaging frames), Frame 2 patient info and Frame 8
visit history both wired to real data, `AppNavShell.tsx` extracted as a
shared component; a layout regression (an extra title row silently adding
~50px of height, invisible on a wide monitor but enough to cause vertical
scroll on a 17"-class screen) was caught by comparing against the mockup
and fixed. Also same day: visit closing fully implemented
(`useOpenVisit`/`useVisit.ts`'s `closeVisit()`), closing the last gap in
"Visit lifecycle" above; a critical load-query bug this depended on was
caught and fixed before shipping (loading only the current visit's own
rows would have made the chart appear to reset to blank on a patient's
second visit); per-tooth and per-patient treatment history both built,
sharing one formatter (`describeToothRecord.ts`) so they can't disagree.
See "Visit lifecycle" and "Patient Record page" above for the full
picture.)

*Previous entry: 2026-09-08 (patient list built — PatientList.tsx/
usePatients.ts, replacing the single hardcoded TEST_VISIT_ID; a new
useOpenVisit(patientId) hook resolves/creates a real per-patient visit for
PatientChart.tsx to load/save against, confirmed working. Patient record
extended: sex narrowed to M/F only per Monika's explicit request (no
"other"); phone/email/address/healthCardNumber added per Gregor's request,
then address split further into address(street)/postalCode/city per
Monika's request — all confirmed working, migrations 007-009 run on the
live project. Telefon uses react-phone-number-input matched to the sibling
"dental calendar" app's own usage; Št. zdravstvene kartice constrained to
exactly 9 digits. Previous entry, same day: real dirty-tracking added to
useVisit.ts's
flush() — a lastSavedRef snapshot is diffed per field per tooth via plain
reference checks, so a save now only writes teeth that actually changed,
confirmed working; bridgeGroupByFdi now persists too —
tooth_records.bridge_group_id, migration 006_add_bridge_group.sql,
confirmed live: a bridge formed via "Člen mostu" survives a reload; the
old shared Supabase project's now-orphaned patients/visits/tooth_records/
treatment_entries tables were dropped, confirmed, leaving it purely the
appointment-scheduling/consent-storage app's own. Previous entry, 2026-09-07:
first working Supabase save/load pipeline confirmed live by Monika —
useVisit.ts loads and autosaves one visit's
tooth_records, ~30s after the last change or immediately on sign-out;
App.tsx now requires a real Supabase Auth login to reach PatientChart
instead of the VITE_DEV_PAGE=patient bypass; all 5 pending migrations run
against the live project, which turned out to already be shared with a
separate, unrelated appointment-scheduling/consent-storage app neither
Monika nor this session had the full picture on at first — then split into
its own brand-new, dedicated Supabase project ("Dental charting") once
that sharing's real risk (the other app's backend holds a service-role
key, bypassing RLS project-wide) became clear, with schema.sql run fresh
there, .env repointed, Monika's login and the test visit re-created; bridge
creation
rewritten from purely status-driven bracket inference — which went through
three rounds (loose, both-ends-anchored, matching-anchor-type) and kept
either drawing nothing for an unclosed bridge or silently welding an
unrelated neighboring crown/implant into a phantom one — to an explicit
fdi->group-id map set only by selecting an anchor together with its
pontics and clicking "Člen mostu", now also able to cross the arch's own
midline and enforcing matching anchor types; applying a status/post/
endo-stage/bridge from StatusToolbar no longer clears the chart selection
afterward; abrasion/sealant/overlay applied via an individual surface
click now redirect to the whole-tooth path, since none of their own marks
ever read any surface but the whole tooth (or, for abrasion on posterior
teeth, the occlusal one); pocket-depth/gum-margin entry built —
click-to-focus + type-a-number, BOP/sign toggle on a second click or
Shift+digit, auto-advance, nullable PocketDepths/GumMargin tuples,
placeholder circles so empty points are actually discoverable)*
*Project: Monikina ordinacija — digitalizacija*
*Stack: React 18 + Vite + TypeScript + Supabase (EU)*
