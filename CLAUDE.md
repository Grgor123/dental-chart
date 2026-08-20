# CLAUDE.md — Dental Practice Management App

> This file is the authoritative guide for this project. Read it fully before writing any code.
> When in doubt about conventions, architecture, or scope — refer here first.

---

## Project Overview

A web-based dental practice management application for a single-dentist private practice in Slovenia. The primary user is **Monika** (the dentist). The app replaces paper-based patient records (EL 81 form) and must be usable during a clinical appointment — fast, clear, touch-friendly.

**Phase 1 scope: Dental Chart only.**
Everything else (billing, appointments, ZZZS reporting) comes later.

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
      BridgeRow.tsx            # One quadrant's mostiček bracket(s) — auto-
                                # detected from crown/implant + bridge_pontic
                                # runs in statuses; also draws the fissure-
                                # sealant tilde and overlay's cap, sitting
                                # above TlorisRow (below it, upper arch)
      TlorisRow.tsx            # One quadrant's tlorisni-pogled squares
      NumberRow.tsx            # One quadrant's FDI number labels
      ToothTopView.tsx         # Single FDI square — tlorisni pogled
      ToothSideView.tsx        # Single anatomic profile — stranski pogled
                                # (also exports ToothSideViewContent, the
                                # <defs>/<g> content with no wrapping <svg>,
                                # reused inside PerioGraphRow's shared canvas)
      perioStyle.ts            # Shared PD color thresholds + mesial/mid/distal
                                # x-fractions, used by PerioGraphRow and
                                # PocketDepthRow so the two stay consistent
    ui/
      StatusSymbol.tsx         # x-cross / endo-circle glyphs
      StatusLegend.tsx         # Color + symbol legend, all statuses
      SurfaceChip.tsx          # Clickable surface badge (not built yet)
      PatientBadge.tsx         # Name, age, diagnoses (not built yet)
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
  hooks/
    useAuth.ts                 # Supabase session state + signIn/signOut
  lib/
    supabase.ts                # Supabase client
  pages/
    Login.tsx                  # Email/password sign-in screen
    PatientChart.tsx           # Main page (still placeholder patient/mock data)
    StatusShowcase.tsx         # Temporary dev-only review page for visual QA —
                                # not part of the app's real navigation
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
  | 'endo'           // endodontsko zdravljenje (kanal) — dokončano
  | 'endo_planned'   // endodontsko zdravljenje — potrebno / v teku
  | 'endo_existing'  // endodontsko zdravljenje — obstoječe (pred spremljanjem)
  | 'implant'
  | 'abrasion'       // abrazija
  | 'overlay_planned'  // predviden overlay
  | 'overlay'          // overlay — dokončan
  | 'overlay_existing'  // overlay — obstoječ (pred spremljanjem)
  | 'extraction_planned'  // predvidena ekstrakcija — zob še prisoten
  | 'extracted'      // ekstrahiran — zob odstranjen
  | 'missing'        // manjkajoč (ni bil prisoten)
  | 'impacted'       // impaktiran (neizrastel)
  | 'prosthesis'         // zob v protezi (odstranljiva proteza, ne naravni zob)
  | 'prosthesis_crown';  // naravni zob s krono, nosilec proteze (proteza na kroni)

// Surface-level status map
export type SurfaceMap = Partial<Record<Surface, ToothStatus>> & { all?: ToothStatus };

// Pocket depths: [mesial, mid, distal] in mm
export type PocketDepths = [number, number, number];

// Gingival margin position relative to CEJ: [mesial, mid, distal] in mm.
// 0 = at the CEJ. Negative = receded apical to CEJ (root exposed — the
// common case, and what "luščenje - glajenje" is tracked against).
// Positive = gum sits coronal to CEJ (covering some crown).
export type GumMargin = [number, number, number];

// Bleeding on probing (BOP): [mesial, mid, distal], one flag per probing
// point — same 3 points as PocketDepths, tracked per surface like pockets
// and gum margin, since BOP is clinically meaningful on both.
export type BleedingPoints = [boolean, boolean, boolean];

// Fissure-sealant lifecycle — same three-stage model as endo_existing/
// endo/endo_planned and overlay_existing/overlay/overlay_planned:
// 'existing' (grey) marks one already there before this practice started
// tracking it, 'planned' (red) one still to be placed, 'done' (blue) one
// just placed. Kept as its own field rather than folded into ToothStatus
// (see ToothData.sealant below) — a plain three-value type, not a new
// ToothStatus, for the same reason it was a boolean before: it needs to
// combine freely with whatever else is going on for that tooth.
export type SealantStage = 'planned' | 'done' | 'existing';

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
  canal?: boolean;
  post?: boolean;  // zobni kolček (zatič) — vstavljen v koreninski kanal
  sealant?: SealantStage;  // zalitje fisur — zaščitni premaz na okluzalni ploskvi
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
  sex: 'M' | 'F' | 'other';
  diagnoses: string[];
  visits: VisitRecord[];
}
```

---

## Supabase Schema

```sql
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
```

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
  line — see the `abrasion` exception below; the `endo`/`endo_planned`
  circle symbol, blue/red respectively at the same `3px` weight — see
  "Canal display" below; and the `extraction_planned`/`extracted` X-cross,
  same `3px` weight and the same red/blue as `endo`/`endo_planned` (see
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
  with a status like `endo`/`endo_planned` that also draws a circle
  reaching those same outer edges. Monika caught this on tooth 33 ("these
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
  same two colors `endo`/`endo_planned` and `extraction_planned`/
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
  this chart. Applied to `endo_existing` (see "Canal display" below),
  `overlay_existing` (see "Bridge display" below), the fissure-sealant
  field's own `'existing'` stage (`ToothData.sealant`, a `SealantStage` —
  see "Bridge display" below), and — after an initial round where it was
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
  **`endo`/`endo_planned`/`endo_existing`, `extraction_planned`,
  `overlay_planned`/`overlay`/`overlay_existing`, and `caries`/
  `caries_treated`/`filling` all get the same white treatment as
  `healthy`** instead of falling through to that bare fallback. Each of these fills
  `'none'` in `statusStyles.ts` and has no symbol of its own in the side
  view (their markers — endo-circle, overlay's cap, extraction's X,
  caries/filling's dot — are drawn elsewhere: the tloris square,
  `BridgeRow`'s own row, or not at all in this view), so without this
  exception the crown falls through to fully transparent, and with
  nothing painted over the root-grey base layer underneath, the *whole*
  tooth (crown included) reads as solid grey instead of the normal
  grey-root/white-crown split. This is exactly the bug Monika caught on
  tooth 36 for `endo` ("why is the whole tooth `#D8D5CC`, we don't have
  that color for crowns") — none of these statuses change a tooth's
  outward appearance, so a plain white crown (the same as any other
  present, unremarkable tooth) is correct for all of them. The list has
  grown by re-discovery, not by design: each new status added to this
  exception was caught only once someone actually looked at that specific
  status *alone*, with no other status also fixing the crown incidentally.
  `caries`/`caries_treated` were one such instance — every earlier demo of
  either happened to sit on a tooth that also had `endo`/`endo_planned`
  set (teeth 33/36), which already fixed the crown, so the gap stayed
  invisible until tooth 16 (plain `{ all: 'caries' }`, no endo involved)
  exposed it. `filling` joined the list later still, once it switched from
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
Upper and lower arches stack their rows in different orders — the tooth
number sits innermost (closest to the tloris squares) for the upper arch,
but outermost (below the tooth artwork) for the lower arch, per feedback
that it reads better there:
```
[Upper arch]                      [Lower arch]
  stranski pogled + REC             globina žepka (oralno/lingvalno)
  (korenine gor)                    mostiček (če obstaja)
  globina žepka (vestibularno)      tlorisni pogled
  tlorisni pogled                   globina žepka (vestibularno/bukalno)
  mostiček (če obstaja)             stranski pogled + REC
  globina žepka (oralno/lingvalno)  (korenine dol)
  tnum                              tnum
```
Which pocket-depth row is vestibular (buccal) vs. oral (lingual) follows
the *same* top=buccal/bottom=lingual (upper arch) or top=lingual/
bottom=buccal (lower arch) convention already used for the tloris squares'
own surface zones (see `zoneSurfaces` in `ToothTopView.tsx`) — a reading's
position in this stack means the same anatomical thing it means there.

**`mostiček` sits on opposite sides of `tlorisni pogled` between the two
arches** — above it on the lower arch, below it on the upper arch (`flip`
on `BridgeRow`, see "Bridge display" below) — a later addition, not the
original design shown in most of this section's own history. The dental
post triangle (see "Dental post" below) reaches outward from the tloris
square's own top edge on the upper arch and bottom edge on the lower arch;
`mostiček`'s bracket needs to sit on the *other* edge on each arch to
avoid drawing on top of it, which is why the two arches' stacks are no
longer simple mirrors of each other around `tlorisni pogled` the way the
rest of this diagram still is.

### Status color palette
| Status | Color | Notes |
|---|---|---|
| healthy | none (transparent) | Blank — no fill reads as untouched |
| caries | none (transparent) | Label "Karies / poka" — a fracture/crack is marked exactly the same way as caries, see the `fracture` removal note below. No whole-surface fill (was coral, `#F0997B`) — a 3px red (`#E94949`, `TODO_COLOR`) dot at the center of each affected surface instead. Still needs treatment — see "Tlorisni pogled" below |
| caries_treated | none (transparent) | Relabeled "Plomba" (was "Karies (sanirano)") — once treated, that surface simply *is* a filling. Same dot marker as `caries`, blue (`#1412A9`, `DONE_COLOR`) instead of red — treatment done |
| filling | none (transparent) | Relabeled "Plomba (obstoječa)" (was flat `#FFFFFF`) — a pre-existing restoration, already there before this practice started tracking the tooth, per Monika's explicit request that this render the same grey-dot way `endo_existing`/`overlay_existing` do rather than a flat fill: "a patient can come with many amalgam fillings and these should be marked." Same per-surface dot mechanism as `caries`/`caries_treated`, grey (`#8a8f94`, `STATUS_COLOR`) — see "Tlorisni pogled" below |
| crown | #9FE1CB | Teal. Also used for a bridge anchor tooth (there's no separate `bridge_anchor` status anymore, per Monika's explicit request — see "Bridge display" below) and for a prosthesis anchor (`prosthesis_crown`, its own status, below) |
| endo | none (transparent) | No whole-tooth fill (was green, `#C0DD97`) — instead a blue (`#1412A9`, `DONE_COLOR`) circle drawn inside the tooth's own square ("endo-circle" symbol), marking treatment done — see "Canal display" below |
| endo_planned | none (transparent) | Same circle symbol as `endo`, red instead of blue — treatment still needed / in progress. **Not** `TODO_COLOR` — its own dedicated `#e24e4e` (`ENDO_PLANNED_COLOR`), slightly more saturated, compensating for how this symbol's thin stroke renders lighter on screen than `TODO_COLOR` does elsewhere — see "Canal display" below |
| endo_existing | none (transparent) | Same circle symbol again, grey (`#8a8f94`, `STATUS_COLOR`) instead of red/blue — a root canal already done before this practice started tracking the tooth, not something newly planned or newly completed. See "Canal display" below |
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
  prevleka where bridge is fixed on." `isBridgeAnchorStatus()`
  (`BridgeRow.tsx`) now checks `crown`/`implant` instead of
  `bridge_anchor`/`implant`.
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
  Monika's explicit feedback. The bracket is **auto-detected from
  `statuses`**, not a separate "which teeth are bridged" prop: it scans
  each quadrant's own FDI display order for a contiguous run that starts
  and ends on an anchor with only `bridge_pontic` teeth in between, same
  as every other row already reads `surfacesByFdi`/`statuses` — so a
  bridge just needs its teeth's own statuses set correctly and it shows
  up, no additional data-model plumbing. **An anchor is `crown` *or*
  `implant`** (`isBridgeAnchorStatus()`) — there's no separate
  `bridge_anchor` status (see the "Status color palette" removal note
  above: a bridge anchor tooth is just a plain `crown`, structurally and
  visually identical to any other crowned tooth). A bridge can also be
  supported by an implant instead of a natural crown, a real and common
  clinical case, so an `implant`-status tooth at either (or both) ends of
  a run is recognized too; its own fixture rendering (`ToothSideView.tsx`'s
  `ImplantFixture`, `ToothTopView.tsx`'s implant fill) is completely
  untouched by this — `BridgeRow` only reads the status to decide where to
  draw the bracket, never changes how the anchor tooth itself renders.
  **This is a looser check than it sounds** — any `crown` tooth adjacent
  to a valid `bridge_pontic` run becomes a recognized anchor automatically,
  since there's no separate marker distinguishing "this crown is a bridge
  anchor" from "this is just an ordinary crown" (there never needs to be:
  the pattern itself — a `bridge_pontic` run terminated by `crown`/
  `implant` on both ends — is what a bridge anchor structurally *is*).
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
- **Fissure sealant (`sealant?: SealantStage` on `ToothData`)** marks a
  tooth whose occlusal fissures have been (or will be) sealed as a
  preventive measure — independent of `ToothStatus`, not a new status
  value, threaded through the component chain the same way `post` already
  is: `DentalChart` → `ArchRow` → `QuadrantBlock` → `BridgeRow`
  (`sealantByFdi` prop) — but landing on `BridgeRow`, not `TlorisRow`,
  since the mark itself lives in the bracket's own row, not inside the
  tloris square. A per-tooth field rather than a `ToothStatus`, same
  reasoning as `post`: sealant commonly coexists with whatever else is
  going on for that tooth (most often nothing at all — it's usually
  applied to an otherwise sound tooth as prevention), so it needs to
  combine freely rather than compete for the single `surfaces.all` slot.
  **`sealant` started as a plain `boolean`** (always rendering the same
  grey tilde) before Monika's explicit request to extend the "status vs.
  to-be-done vs. done" pattern to it too, the same as `endo`/`overlay`
  below — `SealantStage` (`types/dental.ts`) is
  `'planned' | 'done' | 'existing'`, still its own independent type
  rather than folded into `ToothStatus`, for the same combine-freely
  reason as above.
  **Drawn as a small tilde (`~`)**, procedurally as an SVG path (two
  mirrored cubic-Bézier humps), not a text glyph — consistent with every
  other symbol in this chart being a drawn shape rather than a font
  character. Centered at `midGapY` (see above) on the sealed tooth's own
  column — this positioning was actually established *by* the sealant
  tilde first (Monika's original request was specifically about the
  tilde's own placement, "in the middle of the gap between tooth in the
  tloris view and the numbers for pockets"), with the bracket's own bar
  moved to match it afterward, not the other way around. At its current
  size (`SEALANT_HALF_WIDTH`/`SEALANT_AMPLITUDE`, doubled once from an
  initial size per Monika's explicit request) the tilde no longer fits
  inside `BridgeRow`'s own nominal 4px-tall box, so the row's `<svg>` sets
  `overflow: visible` — the same technique already used for the
  dental-post triangle and abrasion's crown-edge outline. Color comes from
  `sealantColorFor()` (`BridgeRow.tsx`) — `TODO_COLOR` (planned),
  `DONE_COLOR` (done), or `STATUS_COLOR` (existing, the original and still
  the default look) — the same three shared colors `overlayColorFor()`
  uses for overlay below.
  **Demoed** on tooth 17 (upper) and 35 (lower) in `StatusShowcase.tsx`
  (`MOCK_SEALANT`), both `'existing'` (their original meaning, unchanged)
  on otherwise plain `healthy` teeth (no entry in `MOCK_SURFACES`) — the
  common real-world case — so both of `flip`'s positions are visible:
  above the tloris squares on the lower arch, below them on the upper
  arch. Teeth 21 and 37 (both `implant`, purple fill) add `'planned'`/
  `'done'` sealant on top, specifically to demonstrate the field's whole
  point — it combines freely with whatever `ToothStatus` the tooth already
  has, rather than competing for the single `surfaces.all` slot.
  **Legend**: since `sealant` isn't a `ToothStatus`, it was never part of
  `StatusLegend.tsx`'s `ORDER`-driven grid (and had no entry there at all
  before this — a known, accepted gap at the time). Now that it has three
  meaningfully different colors, it gets three small hand-added rows
  (same pattern as the BOP row below it), one tilde each in
  `STATUS_COLOR`/`TODO_COLOR`/`DONE_COLOR`.
  **Schema**: changed from `boolean` to
  `text check (sealant in ('planned','done','existing'))` in
  `tooth_records` — edited `supabase/schema.sql` and
  `supabase/migrations/004_add_sealant.sql` **in place** rather than
  adding a new migration, since 004 had never been run anywhere live yet
  (still true as of this writing — not yet run on the live project, same
  as migrations 001–003).
- **Overlay (`overlay_planned`/`overlay`/`overlay_existing` statuses)**
  marks a partial-crown restoration covering the cusps — a real
  three-state `ToothStatus` set this time, not an independent field like
  `post`/`sealant` (there's no reason an overlay would need to combine
  with some *other* whole-tooth status the way a post or sealant does, so
  it fits the existing `surfaces.all` slot fine). Same planned/done/
  existing pattern and the same shared `TODO_COLOR`/`DONE_COLOR`/
  `STATUS_COLOR` as every other such pair/triple on the chart
  (caries/caries_treated, endo/endo_planned/endo_existing,
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
  white-crown fix `endo`/`extraction_planned` already have
  (`isOverlayStatus`, folded into the same branch, covering all three
  statuses) — otherwise a `fill: 'none'` status with no symbol of its own
  falls through to the see-through-grey look reserved for actually-absent
  tooth structure, the same bug Monika originally caught on `endo` (tooth
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
  matching the weight `abrasion`/`endo`/the extraction pair all use for
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

**Status: built — the doctor's revised spec.** An earlier version (a
pulp-chamber-to-apex line traced through the root, colored red/blue for
planned/done) was built, shipped briefly in the "Cela karta" demo, then
removed after Monika discussed canal/endo charting with the doctor —
see the git history around 2026-08-18 if that approach is ever revisited.
The doctor's actual request, once clarified, turned out to be much
simpler: not a line inside the root at all, just a **symbol in the tloris
(top-down) view** — a plain circle centered inside the tooth's own
square, color-coded by treatment stage. No per-canal-count detail (a
molar's 2–3 real canals aren't distinguished), no side-view geometry —
this is a status marker, not an anatomical rendering.

- **Three statuses, not one status + a flag**: `endo` (treatment done),
  `endo_planned` (still needs doing / in progress), and `endo_existing`
  (done before this practice started tracking the tooth — added later,
  per Monika's explicit request to extend the same "status vs. to-be-done
  vs. done" pattern `missing`/`extraction_planned`/`extracted` already
  demonstrated to the other treatment pairs on the chart) — same pattern
  already used for other multi-state pairs in `statusStyles.ts`
  (`extracted`/`missing`), chosen over a single `endo` status plus a flag
  (the approach the earlier, since-removed, canal-line feature used) for
  consistency with those.
- **Colors**: blue (`#1412A9`, `DONE_COLOR`) for `endo`, grey (`#8a8f94`,
  `STATUS_COLOR`) for `endo_existing` — the same shared colors every other
  todo/done/existing marker on the chart uses (see the caries-dot color
  note under "Tlorisni pogled" above), not a dedicated set of their own.
  This is a reversal from how the feature first shipped: `endo`/
  `endo_planned` originally had their own fresh, dedicated hex
  (`#1413A9`/`#F04343`, deliberately *not* reused from elsewhere), on the
  same "distinct clinical marker, not the same one repainted" reasoning
  `caries` also used at the time — Monika's later explicit request
  reverted that app-wide, red/blue/grey should always mean the same thing
  everywhere. Set via `symbolColor` on each status in `statusStyles.ts`,
  the same mechanism `bridge_pontic` already uses to decouple a symbol's
  color from the square's own border.
  **`endo_planned` is the one exception to that unification**, and only
  because of how *this specific symbol* renders, not a reversion of the
  policy: its circle is a thin 3px stroke, not a solid filled shape like
  `caries`'s own dot, so the same `TODO_COLOR` hex reads visibly
  lighter/more washed-out on screen there than it does elsewhere (likely
  anti-aliasing/blending with the background at that stroke width) —
  Monika confirmed the on-screen color as "#E35656" (a perceptibly
  pinker, lighter red than `TODO_COLOR`'s own `#E94949`) once she checked
  it live, and asked for `#e24e4e` instead specifically here, while
  confirming every *other* red marker on the chart (caries' dot,
  extraction's X, overlay's cap, sealant's tilde) already reads correctly
  as-is. Rather than adjust `TODO_COLOR` itself — which would have shifted
  all of those too — `endo_planned` alone reads from its own
  `ENDO_PLANNED_COLOR` constant (`statusStyles.ts`), not `TODO_COLOR`.
- **The symbol itself** is a new `StatusSymbol` type, `'endo-circle'`
  (`ui/StatusSymbol.tsx`) — a plain unfilled circle centered in the
  caller's bounding box, using the full passed-in `strokeWidth` (meant to
  read as a bold, deliberate mark, not fine annotation detail — unlike the
  now-removed `granuloma` status's own `'granuloma-circle'` symbol type,
  which scaled its stroke down to `* 0.5` for exactly the opposite reason;
  see the "Status color palette" removal note above). `ToothTopView.tsx`
  sizes it to **touch the square's own outer
  edges** — a centered `x=1,y=1,width=26,height=26` box (the same one
  `bridge_pontic`'s cross reaches), which for a circle means
  `r = min(width,height)/2 = 13` centered at `(14,14)`, exactly the
  square's own center — per Monika's explicit request, and matching how
  `prosthesis`'s own circle (`cx=14,cy=14,r=13`) already fills the same
  footprint. Stroke width is **3px**, the same weight as `abrasion`'s own
  mark, again per Monika's explicit request — not the `1px` every other
  line in this view uses (see the line convention under "Tlorisni pogled"
  above, which lists `endo`/`endo_planned` alongside `abrasion` as the
  two deliberate exceptions to that convention, both now sharing the same
  `3px` weight).
- **Replaces the flat whole-tooth fill**, not layered on top of it: all
  three of `endo`/`endo_planned`/`endo_existing` set `fill: 'none'`, the
  same way `extracted`/`missing`/`prosthesis` forgo a fill in favor of a
  symbol. `endo` previously filled the whole tooth green (`#C0DD97`) —
  gone now, replaced by the circle. The square's own outline stays the
  default dark (`border` unset on all three statuses) — only the circle
  carries the status color. This is tloris-view only — the side view has
  no equivalent symbol for any of the three, and needed its own explicit
  fix to avoid an all-grey tooth once the flat fill went away; see the
  "Healthy-tooth coloring" exception under "Stranski pogled" below
  (`isEndoStatus` there covers all three statuses, not just the original
  two).
- **A real tooth, not a prosthetic unit**: unlike `bridge_pontic`/
  `prosthesis`, none of the three endo statuses skip
  per-surface subdivision — the triangles, occlusal rectangle, and divider
  lines all still render normally (just unfilled, since `fill` is
  `'none'` for all three); only the symbol is special-cased.
- **Whole-tooth only**, same simplification as every other symbol-driven
  status in this view (`surfaces.all`, not per-surface) — setting `endo`
  on an individual surface (e.g. `{ m: 'endo' }`) still resolves via
  `regionFillFor()` like before, but now renders that surface transparent
  rather than green, since there's no per-surface equivalent of the
  circle symbol. Not a new limitation — `extracted`/`missing`/`prosthesis`
  already only render their symbol at the whole-tooth level too.
- Demoed on tooth 34 (`endo_planned`, red, isolated), tooth 47 (`endo`,
  blue, isolated), and tooth 22 in the main "Cela karta" chart plus tooth
  41 in the swatch grid (`endo_existing`, grey, isolated) in
  `StatusShowcase.tsx`, so all three circle colors are visible side by
  side on their own. Teeth 33 and 36 combine an
  endo-circle with per-surface caries dots on top — one of each state, per
  Monika's explicit request first for the done case (36, blue) then the
  to-do case (33, red) — demonstrating that a whole-tooth symbol
  (`surfaces.all`) and per-surface markers (caries dots) coexist
  correctly regardless of which endo state is involved: `surfaces.all`
  still drives the endo-circle regardless of what any individual surface
  is overridden to, since `statusFor()` only falls through to
  `surfaces.all` for surfaces *without* their own override — see the
  caries exception under "Tlorisni pogled" above.

### Dental post (zobni kolček)

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
  `ToothStatus` rather than compete with one for the single `surfaces.all`
  slot the way e.g. `endo` and `caries` would if both were whole-tooth
  statuses (`ToothData.canal`, the older leftover field this pattern
  echoes, predates the `endo`/`endo_planned` statuses that superseded its
  original purpose — `post` is a distinct, still-live concept, not a
  rename of it).
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
  supports a crown) **and tooth 36** (lower, already `endo` + caries dots
  — a post commonly follows a root canal) in `StatusShowcase.tsx`
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
  `endo`/`endo_planned` — and, per Monika's explicit request, the exact
  same two shared colors (`TODO_COLOR`/`DONE_COLOR`, see the caries-dot
  color note under "Tlorisni pogled" above for why these are shared
  rather than each pair's own dedicated shade). `missing` isn't part of
  this pair; it has no "done" or "to-do" state of its own, just a fixed
  fact about the tooth.
- **X-cross weight is 3px**, not this view's usual 1px, for both
  `extraction_planned` and `extracted` — the same deliberate exception
  `abrasion`'s mark and `endo`/`endo_planned`'s circle already get (see
  the line convention under "Tlorisni pogled" above), per Monika's
  explicit follow-up request once she'd seen the default 1px weight on
  localhost. In `ToothTopView.tsx` this is `isExtractionPair` folded into
  the same `strokeWidth={isEndo || isExtractionPair ? 3 : LINE_WIDTH}`
  check `isEndo` already used. In `ToothSideView.tsx` the x-cross render
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

### Click on tooth
- Opens detail panel below chart
- Shows: tooth number, type, all surface statuses, pocket depths (B + L), notes field
- Surface chips are clickable to change status (dropdown or quick-select)

### Status change flow
1. Click tooth → detail panel opens
2. Click surface chip → status picker appears (list of all statuses)
3. Select status → surface updates visually immediately (optimistic UI)
4. Auto-save to Supabase after 1s debounce

### Two record layers
- `initial_status` — stanje ob prvem pregledu (anamneza)
- `visit_entries[]` — vsak obisk doda nov zapis

Display toggle: "Začetno stanje" / "Obisk [datum]" — allows seeing history.

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

- [x] Supabase project setup (EU region, schema applied, RLS enabled) —
      confirmed live (RLS blocks unauthenticated reads correctly); the
      `gum_margin` migration (`supabase/migrations/001_add_gum_margin.sql`),
      the `bleeding` surfaces migration
      (`supabase/migrations/002_add_bleeding_surfaces.sql`), the
      dental-post migration (`supabase/migrations/003_add_post.sql`), and
      the fissure-sealant migration
      (`supabase/migrations/004_add_sealant.sql`) still need to be run on
      it
- [ ] Auth: single user login (Monika) via Supabase Auth email/password —
      `Login.tsx` + `useAuth.ts` built and functional, but not yet wired as
      the app's actual entry point (`App.tsx` currently shows the dev-only
      `StatusShowcase` review page instead — see its `SHOW_STATUS_SHOWCASE`
      flag), and Monika's user account in Supabase isn't confirmed created
- [ ] Patient list page (search by name) — not started
- [ ] Patient chart page with full FDI dental chart — `PatientChart.tsx`
      renders the real `DentalChart`, but against a placeholder/no real
      patient, not Supabase data
- [ ] Tlorisni pogled — all 32 teeth, correct surfaces, click to edit —
      rendering, per-surface status fill, and tooth selection on click are
      done; there's no editor yet for a click to actually open
- [ ] Stranski pogled — anatomic profiles, pocket depths, canals —
      profiles + a full perio graph (pocket depth, gum margin) are done
      and go well beyond the original spec (see "Perio graph" above);
      endodontic treatment now has a tloris-view status symbol
      (blue/red circle, `endo`/`endo_planned` — see "Canal display"
      above), the doctor's actual final spec, replacing an earlier
      root-canal-line idea that was built and then removed; no
      side-view canal/root geometry is shown, by design
- [x] Status color fill per surface
- [ ] Detail panel on tooth click — not started
- [ ] Save tooth status to Supabase — not started (no writes exist yet,
      only reads for auth)
- [ ] Visit history toggle (initial vs visit records) — not started
- [ ] Basic print view (chart only, A4) — not started

## Out of Scope for Phase 1
- eZdravje / ZZZS integration
- Billing / invoicing
- Appointment booking
- Mlečni zobje (primary teeth — 5x/6x/7x/8x series)
- Periodontogram as separate full-screen view
- SMS/email reminders
- Multi-user / multi-dentist

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
- Bridge display: auto-detected bracket (`BridgeRow`) over anchor/pontic
  runs, anchored on a natural crown or an implant, pontic drawn as a
  solid-outline square with an X-cross (same dark color as every other
  tooth's outline) in the tloris view and completely blank (no crown,
  root, or outline) in the side view; the bracket flips to sit below
  `TlorisRow` on the upper arch (`BridgeRow`'s `flip` prop) so it no
  longer collides with the dental post there — see "Bridge display" above
- Prosthesis (removable-denture) tooth status: circle-in-place-of-square
  rendering in the tloris view, adjacent teeth linked with a connector
  line (including across the arch midline) — see "Tlorisni pogled" above;
  `prosthesis_crown` extends the same connector to natural crowned teeth
  anchoring the same prosthesis, rendered as a completely ordinary crown
- Endodontic treatment status symbol: blue/red circle-in-square
  (`endo`/`endo_planned`) in the tloris view, the doctor's final spec
  after an earlier root-canal-line idea was tried and removed — see
  "Canal display" above
- Caries marker: a per-surface red/blue dot (`caries`/`caries_treated`),
  not a flat fill — the one status pair in the whole chart that marks
  individual surfaces rather than only the whole tooth — see "Tlorisni
  pogled" above
- Dental post (zobni kolček): a hollow triangle touching the tloris
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
  (caries/caries_treated, endo/endo_planned/endo_existing,
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
- Fissure sealant (zalitje fisur): a small tilde drawn in the same shared
  row as the bridge bracket (`BridgeRow.tsx`), both centered on the true
  midpoint of the gap between the tloris squares and the pocket-depth
  numbers row; independent of `ToothStatus` (`ToothData.sealant`, a
  `SealantStage` — `'planned' | 'done' | 'existing'` — threaded like
  `post`, upgraded from a plain boolean once it gained the same
  three-color treatment) — see "Bridge display, fissure sealant, and
  overlay" above
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
- Status cleanup pass, per Monika's explicit request while reviewing the
  Legenda: `bridge_anchor` removed (a bridge anchor is just a plain
  `crown` now — `isBridgeAnchorStatus()` in `BridgeRow.tsx` checks
  `crown`/`implant`); `planned` removed as redundant with `endo_planned`;
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
- Supabase project (schema applied, RLS confirmed working) and a
  functional login screen (`Login.tsx` + `useAuth.ts`)

**Not started, roughly in the order they'll matter:**
1. Run `supabase/migrations/001_add_gum_margin.sql`,
   `supabase/migrations/002_add_bleeding_surfaces.sql`,
   `supabase/migrations/003_add_post.sql`, and
   `supabase/migrations/004_add_sealant.sql` on the live project
2. Confirm/create Monika's user in Supabase Auth, then flip `App.tsx` back
   to the real login flow (remove the `SHOW_STATUS_SHOWCASE` dev flag and
   its `StatusShowcase` import)
3. Patient list page + a real patient/visit data flow into `DentalChart`
   (replacing `PatientChart.tsx`'s placeholder), via custom hooks
   (`usePatient`, `useVisit`) per the Supabase-calls convention below
4. Click-to-edit: detail panel on tooth click, surface status picker,
   auto-save to Supabase
5. Visit history toggle, print view

---

*Last updated: 2026-08-20 ("Primeri — cel zob" removed from StatusShowcase.tsx, per Monika's request — EXAMPLES and the now-dead ToothColumn.tsx deleted)*
*Project: Monikina ordinacija — digitalizacija*
*Stack: React 18 + Vite + TypeScript + Supabase (EU)*
