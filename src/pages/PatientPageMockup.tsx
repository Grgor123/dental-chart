import { useEffect, useState, type MouseEvent } from 'react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { DentalChart } from '../components/chart/DentalChart';
import { hidesSurfaceDetail } from '../components/chart/ToothTopView';
import { StatusToolbar } from '../components/ui/StatusToolbar';
import { AppNavShell } from '../components/ui/AppNavShell';
import { UPPER_LEFT, UPPER_RIGHT, LOWER_LEFT, LOWER_RIGHT } from '../data/toothMeta';
import type {
  Surface,
  SurfaceMap,
  PocketDepths,
  GumMargin,
  BleedingPoints,
  EndoStage,
  ToothStatus,
} from '../types/dental';

// ============================================================================
// MOCKUP ONLY — not wired to Supabase, not part of the app's real
// navigation, dev-only (VITE_DEV_PAGE=patient-mockup, see App.tsx), same
// pattern as StatusShowcase.tsx. Second iteration, per Gregor's explicit
// follow-up requests on the first pass:
//  1. Fields now carry sample data instead of sitting empty (the first pass
//     was screenshotted with a blank "+ Nov pacient" form by mistake).
//  2. Each arch's own "Zgornja/Spodnja čeljust — …" label is hidden
//     (DentalChart's new hideArchLabels prop) and the chart's own padding/
//     inter-arch gap tightened (its new compact prop) to reclaim vertical
//     space so the tab panel below is more likely to fit without scrolling.
//  3. The chart is now genuinely clickable — the same select-then-apply
//     StatusToolbar flow PatientChart.tsx uses (handleTargetClick/
//     handleStatusClick/handleCreateBridge/handleTogglePost/
//     handleSetEndoStage below are close copies of that file's own
//     versions), all in local component state only — nothing here reads
//     from or writes to Supabase. Rendered as a wide horizontal bar BELOW
//     the chart (StatusToolbar's new `className` override) rather than a
//     narrow sidebar beside it, both to avoid widening this column and
//     because a wide bar is shorter than a tall narrow one.
//  4. The legend panel is now two tabs — "Legenda" (the real, already-built
//     StatusLegend) and "Storitve po zobeh" (click a tooth on the chart
//     above, see its history here). The history itself
//     (MOCK_TOOTH_HISTORY below) is entirely fabricated for a handful of
//     teeth — there's no real per-tooth chronological-history feature or
//     data model built yet (see CLAUDE.md's "Not started" list); this only
//     pins down where that future feature would live and how it'd be
//     reached, the same way the other placeholder panels below do.
//
// Still purely illustrative placeholders, unchanged from the first pass:
// the red health-questionnaire banner, "Pretekli termini in storitve", the
// "Podrobnosti termina" panel, and the Rentgeni/Fotografije/SMS/E-pošta row.
// ============================================================================

const MOCK_POCKETS_BUCCAL: Record<string, PocketDepths> = {
  11: [2, 2, 2], 12: [2, 3, 2], 13: [2, 2, 3], 14: [3, 2, 2], 15: [2, 2, 2], 16: [3, 4, 3], 17: [2, 3, 2], 18: [2, 2, 2],
  21: [2, 2, 3], 22: [2, 2, 2], 23: [3, 2, 2], 24: [2, 3, 2], 25: [2, 2, 2], 26: [3, 4, 3], 27: [2, 3, 5], 28: [2, 2, 2],
  31: [2, 2, 2], 32: [2, 2, 2], 33: [2, 2, 3], 34: [3, 2, 2], 35: [2, 2, 2], 36: [4, 3, 2], 37: [2, 2, 2], 38: [2, 2, 2],
  41: [2, 2, 2], 42: [2, 2, 2], 43: [3, 2, 2], 44: [2, 2, 3], 45: [2, 2, 2], 46: [3, 3, 4], 47: [2, 2, 2],
};

const MOCK_POCKETS_LINGUAL: Record<string, PocketDepths> = {
  11: [2, 2, 3], 12: [2, 2, 2], 13: [2, 3, 2], 14: [2, 2, 2], 15: [3, 2, 2], 16: [2, 3, 2], 17: [3, 2, 3], 18: [2, 2, 2],
  21: [2, 3, 2], 22: [2, 2, 2], 23: [2, 2, 2], 24: [3, 2, 2], 25: [2, 2, 3], 26: [2, 2, 4], 27: [2, 2, 2], 28: [2, 3, 2],
  31: [2, 2, 2], 32: [3, 2, 2], 33: [2, 2, 2], 34: [2, 2, 2], 35: [2, 3, 2], 36: [2, 4, 3], 37: [2, 2, 2], 38: [2, 2, 3],
  41: [2, 2, 2], 42: [2, 2, 2], 43: [2, 2, 2], 44: [3, 2, 2], 45: [2, 2, 2], 46: [2, 2, 3], 47: [2, 3, 2],
};

const MOCK_GUM_MARGIN: Record<string, GumMargin> = {
  11: [0, 0, 0], 12: [-1, 0, 0], 13: [-1, -1, 0], 14: [0, -1, 0], 15: [0, 0, -1], 16: [-2, -1, -2], 17: [-1, -1, 0], 18: [0, 0, -1],
  21: [-1, 0, -1], 22: [0, 0, 0], 23: [-1, -1, 0], 24: [0, -1, 0], 25: [0, 0, -1], 26: [-4, -3, -4], 27: [-1, -2, -1], 28: [0, 0, -1],
  31: [0, 0, 0], 32: [0, -1, 0], 33: [-1, 0, 0], 34: [0, 0, -1], 35: [0, 0, 0], 36: [-4, -4, -3], 37: [-1, -1, 0], 38: [0, 0, 0],
  41: [0, 0, 0], 42: [0, 0, 0], 43: [-1, 0, 0], 44: [0, -1, 0], 45: [0, 0, 0], 46: [-2, -2, -1], 47: [-1, -1, 0],
};

const MOCK_BLEEDING_BUCCAL: Record<string, BleedingPoints> = {
  16: [false, true, true],
  36: [true, false, false],
};

const MOCK_BLEEDING_LINGUAL: Record<string, BleedingPoints> = {
  26: [false, false, true],
  46: [false, false, true],
};

const INITIAL_POST: Record<string, boolean> = { 13: true, 26: true, 36: true };

const INITIAL_ENDO: Record<string, EndoStage> = {
  22: 'existing', 33: 'planned', 34: 'planned', 36: 'done', 47: 'done',
};

const INITIAL_SURFACES: Record<string, SurfaceMap> = {
  13: { all: 'crown' },
  14: { all: 'bridge_pontic' },
  15: { all: 'crown' },
  16: { all: 'caries' },
  21: { all: 'implant' },
  25: { all: 'caries_treated' },
  26: { all: 'crown' },
  36: { b: 'caries', o: 'caries', l: 'caries', m: 'caries', d: 'caries' },
  46: { all: 'missing' },
};

const INITIAL_BRIDGE_GROUPS: Record<string, string> = {
  13: 'demo-13-15',
  14: 'demo-13-15',
  15: 'demo-13-15',
};

// Entirely fabricated per-tooth chronological history for the "Storitve po
// zobeh" tab — see the file-level comment above for why this doesn't
// reflect any real data model yet. Only the teeth that already carry a mock
// status above get an entry, so the demo reads as internally consistent.
const MOCK_TOOTH_HISTORY: Record<string, { date: string; opis: string }[]> = {
  13: [{ date: '3. 1. 2023', opis: 'Nameščena prevleka (krona) — sidro mostu 13–15.' }],
  14: [{ date: '3. 1. 2023', opis: 'Izdelan člen mostu med 13 in 15.' }],
  15: [{ date: '3. 1. 2023', opis: 'Nameščena prevleka (krona) — sidro mostu 13–15.' }],
  16: [{ date: '18. 6. 2024', opis: 'Ugotovljen karies.' }],
  21: [{ date: '22. 9. 2022', opis: 'Vstavljen zobni implantat.' }],
  25: [{ date: '5. 11. 2023', opis: 'Karies saniran — plomba.' }],
  26: [
    { date: '3. 1. 2023', opis: 'Nameščena prevleka (krona).' },
    { date: '3. 1. 2023', opis: 'Vstavljen zobni zatiček.' },
  ],
  36: [
    { date: '10. 2. 2021', opis: 'Opravljeno zdravljenje korenin (kanal).' },
    { date: '19. 8. 2024', opis: 'Ugotovljen karies na več ploskvah.' },
    { date: '19. 8. 2024', opis: 'Vstavljen zobni zatiček.' },
  ],
  46: [{ date: '12. 4. 2020', opis: 'Zob manjka — evidentirano ob prvem pregledu.' }],
};

// Frame 8 (left column, below the patient info card): per-visit rollup of
// the exact same events MOCK_TOOTH_HISTORY already lists per-tooth —
// deliberately built from that same data (grouped by date instead of by
// FDI) rather than a second, independent mock dataset, so the two never
// disagree with each other the way CLAUDE.md warns two unrelated mock
// datasets eventually do (see its "Primeri — cel zob" removal note).
// Newest first, per the spec.
const MOCK_VISIT_HISTORY: { date: string; storitve: string[] }[] = [
  { date: '19. 8. 2024', storitve: ['Ugotovljen karies na več ploskvah (zob 36)', 'Vstavljen zobni zatiček (zob 36)'] },
  { date: '18. 6. 2024', storitve: ['Ugotovljen karies (zob 16)'] },
  { date: '5. 11. 2023', storitve: ['Karies saniran — plomba (zob 25)'] },
  {
    date: '3. 1. 2023',
    storitve: [
      'Nameščena prevleka (krona) — sidro mostu 13–15',
      'Izdelan člen mostu med 13 in 15',
      'Nameščena prevleka (krona) (zob 26)',
      'Vstavljen zobni zatiček (zob 26)',
    ],
  },
  { date: '22. 9. 2022', storitve: ['Vstavljen zobni implantat (zob 21)'] },
  { date: '10. 2. 2021', storitve: ['Opravljeno zdravljenje korenin — kanal (zob 36)'] },
  { date: '12. 4. 2020', storitve: ['Zob manjka — evidentirano ob prvem pregledu (zob 46)'] },
];

// Frame 3 (right column, bottom tabbed frame): entirely fabricated content
// for all four tabs, same "pins down where the future feature would live"
// role as MOCK_TOOTH_HISTORY above — no real RTG/photo storage, SMS log, or
// email log exists yet (see docs/patient-record-spec.md's own open
// questions on the RTG integration mechanism).
const MOCK_RTG_GALLERY = [
  { date: '11. 10. 2026', opis: 'Panoramski posnetek (OPG)' },
  { date: '3. 1. 2023', opis: 'Lokalni posnetek — zgornji desni kvadrant' },
  { date: '22. 9. 2022', opis: 'Lokalni posnetek — implantat 21' },
];

const MOCK_PHOTOS = [
  { date: '11. 10. 2026', opis: 'Pred posegom — zgornji lok' },
  { date: '3. 1. 2023', opis: 'Most 13–15, po namestitvi' },
];

const MOCK_SMS = { date: '12. 10. 2026', text: 'Pozdravljeni, vaš termin je potrjen za 14. 3. 2026 ob 10:30. Lep pozdrav, Ordinacija Monika Goslar.' };

const MOCK_EMAILS = [
  { date: '12. 10. 2026', subject: 'Potrditev termina 14. 3. 2026', snippet: 'Pozdravljeni, obveščamo vas, da je vaš termin potrjen…' },
  { date: '2. 1. 2023', subject: 'Napotnica za rentgensko slikanje', snippet: 'V prilogi vam pošiljamo napotnico za OPG posnetek…' },
];

// Frame 5 (right column, appointment card): the five-state machine from
// docs/patient-record-spec.md. Colors are read straight off that spec's
// own table — grey/yellow/green/red for Naročen/Poslana potrditev/
// Potrjen/Zavrnjen, white-with-grey-outline for Ni termina — reusing the
// app's existing red (#e0231c, the top banner's own color) for Zavrnjen
// rather than inventing a second red, same "one meaning, one color"
// reasoning CLAUDE.md documents for the dental chart's own status colors.
type AppointmentStatus = 'ni_termina' | 'narocen' | 'poslana_potrditev' | 'potrjen' | 'zavrnjen';

const APPOINTMENT_STATUS_META: Record<AppointmentStatus, { label: string; pillClass: string }> = {
  ni_termina: { label: 'Ni termina', pillClass: 'border-2 border-[#9CA3AF] bg-white text-[var(--ink,#1c2624)]' },
  narocen: { label: 'Naročen', pillClass: 'bg-[#9CA3AF] text-white' },
  poslana_potrditev: { label: 'Poslana potrditev', pillClass: 'bg-[#F5A623] text-white' },
  potrjen: { label: 'Potrjen', pillClass: 'bg-[#4CAF50] text-white' },
  zavrnjen: { label: 'Zavrnjen', pillClass: 'bg-[#e0231c] text-white' },
};

// Not user-selectable — per Gregor's explicit request, this status is
// never something a person clicks on this card; it's derived automatically
// from the calendar:
//   - "Ni termina" whenever the patient has no upcoming appointment at all.
//   - Otherwise, "Naročen"/"Poslana potrditev"/"Potrjen"/"Zavrnjen" all
//     read off that patient's own NEXT (earliest) upcoming appointment
//     specifically — a patient can have several appointments booked at
//     once, but only the first one drives this card's status.
//   - "Zavrnjen" stays showing until that appointment's own date/hour
//     passes (at which point — once real scheduling data exists — the
//     card would presumably fall through to whatever the new "first
//     upcoming appointment" is, or back to "Ni termina" if none remain).
// None of that derivation exists yet (no real calendar/appointments table
// — see docs/patient-record-spec.md's own open questions), so this is a
// fixed mock value standing in for "today's real answer," same role as
// every other MOCK_* constant on this page.
const MOCK_APPOINTMENT_STATUS: AppointmentStatus = 'potrjen';

// Entirely fabricated, same role as every other MOCK_* constant on this
// page — no real invoicing/billing table exists yet.
const MOCK_INVOICES = [
  { id: 'R-2026-014', date: '14. 3. 2026', storitev: 'Pregled + čiščenje', amount: 45, paid: false },
  { id: 'R-2025-098', date: '2. 11. 2025', storitev: 'Zalitje fisur', amount: 30, paid: false },
  { id: 'R-2025-072', date: '5. 8. 2025', storitev: 'Plomba', amount: 60, paid: true },
];

// Frame 6 (nav shell): extracted to src/components/ui/AppNavShell.tsx so
// the real PatientChart.tsx (which ports this whole layout — see
// CLAUDE.md's "Patient list"/plan history) can share the exact same
// component instead of a second, divergence-prone copy. This mockup keeps
// using it with no props, which stays fully inert/cosmetic exactly as
// before.

const WHOLE_TOOTH_MARKER_STATUSES: ToothStatus[] = [
  'abrasion',
  'sealant_planned', 'sealant', 'sealant_existing',
  'overlay_planned', 'overlay', 'overlay_existing',
];

const ARCHES: readonly (readonly string[])[] = [
  [...UPPER_LEFT, ...UPPER_RIGHT],
  [...LOWER_LEFT, ...LOWER_RIGHT],
];

interface Target {
  fdi: string;
  surface: Surface | 'all';
}

function sameTarget(a: Target, b: Target): boolean {
  return a.fdi === b.fdi && a.surface === b.surface;
}

// "1982-03-12" -> "12.3.1982", matching the mockup's own date display
// (day.month.year, no leading zeros) — the <input type="date"> in edit
// mode still uses the plain ISO string, this is view-mode display only.
function formatSlovenianDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(d)}.${Number(m)}.${y}`;
}

const GENDER_LABELS: Record<string, string> = { M: 'Moški', F: 'Ženski', '': 'Neznano' };

// Deliberately NOT boxed — a bordered/padded input is naturally taller than
// a bare line of text, and Gregor's explicit, repeated request is that this
// whole card stay pinned at its view-mode height (536px) even in edit mode.
// So edit-mode fields get only an underline, same font-size/line-height as
// the view-mode text, no padding — as close as an <input>/<select> can get
// to occupying exactly one text line's worth of height instead of an input
// box's worth. The underline itself is a `box-shadow`, not a `border` —
// a border adds to the element's own box height (that was the last
// remaining 1px-per-field gap once padding was already zeroed), while a
// box-shadow paints without taking up any layout space at all.
const FIELD_INPUT_CLASSES =
  'w-full appearance-none border-0 bg-transparent px-0 py-0 text-base leading-6 text-[var(--ink,#1c2624)] shadow-[0_1px_0_0_var(--line,#ccd6d4)] focus:shadow-[0_1px_0_0_var(--accent,#2e6e62)] focus:outline-none disabled:cursor-not-allowed disabled:text-[var(--muted,#6f7c79)]';
// Plain label-over-value display used while NOT editing — see the
// PatientInfoField helper below and the file-level comment at the top of
// PatientPageMockup for why this mirrors the mockup's read view exactly
// (no border/box at all, just two lines of text).
const VIEW_LABEL_CLASSES = 'text-sm text-[var(--muted,#7e7e7d)]';
const VIEW_VALUE_CLASSES = 'text-base text-[var(--ink,#1c2624)]';
// Scoped override for the one PhoneInput usage in this card — its own
// stylesheet (react-phone-number-input/style.css) doesn't box the inner
// <input> itself, but the browser's default UA border/padding on a bare
// <input> does, which is the same "taller than a text line" problem the
// FIELD_INPUT_CLASSES fields above solve for. Scoped to .ppm-phone-compact
// (this page's only PhoneInput) rather than the bare .PhoneInput classes,
// so it can't leak into any other PhoneInput usage elsewhere in the app.
const PHONE_COMPACT_CSS = `
  .ppm-phone-compact .PhoneInputInput { border: none; padding: 0; background: transparent; font-size: 1rem; line-height: 1.5rem; }
  .ppm-phone-compact .PhoneInputCountryIcon { height: 1.1rem; }
`;

export function PatientPageMockup() {
  // ---- Chart status/service editing — local state only, close copy of
  // PatientChart.tsx's own selection/apply flow (see that file for the
  // fuller reasoning behind each piece). No perio-point (pocket depth/gum
  // margin) editing here — Gregor's request was specifically about
  // services/status, so pockets/gum-margin/bleeding stay static mock props.
  const [surfacesByFdi, setSurfacesByFdi] = useState<Record<string, SurfaceMap>>(INITIAL_SURFACES);
  const [postByFdi, setPostByFdi] = useState<Record<string, boolean>>(INITIAL_POST);
  const [endoByFdi, setEndoByFdi] = useState<Record<string, EndoStage>>(INITIAL_ENDO);
  const [bridgeGroupByFdi, setBridgeGroupByFdi] = useState<Record<string, string>>(INITIAL_BRIDGE_GROUPS);
  const [selection, setSelection] = useState<Target[]>([]);
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);
  // Which tooth "Storitve po zobeh" shows history for — set by clicking
  // anywhere on a tooth's tloris square, same as PatientChart.tsx's own
  // selectedFdi (there, it drives the detail panel; here, the history tab).
  const [selectedFdi, setSelectedFdi] = useState<string | undefined>();
  // Frame 7: "Legenda" (now holding the clickable status toolbar — see
  // below) is the first/default tab; swapped back per Gregor's explicit
  // follow-up request after an earlier round briefly had them the other
  // way around.
  const [activeTab, setActiveTab] = useState<'legenda' | 'storitve'>('legenda');
  const [phone, setPhone] = useState('+38641234567');
  // Frame 1 (top banner): "Vprašalnik" opens a placeholder modal — the real
  // questionnaire responses/data model don't exist yet (see docs/patient-record-spec.md).
  const [questionnaireOpen, setQuestionnaireOpen] = useState(false);
  // Frame 2 (left column, patient info card): modeled directly on
  // design/PatientRecordMockup.svg — plain label-over-value text while
  // viewing (no boxes/borders at all, matching the mockup's read view
  // exactly), swapping to real bordered inputs only once "Uredi" is
  // clicked (the mockup only ever depicts the view state, so the edit
  // state is our own reasonable extrapolation of "toggles into an
  // editable state"). Nothing here writes to Supabase — still local-state
  // mockup only, so "Uredi" -> "Shrani" just flips editMode back off.
  // Field set matches the mockup's own two-column block exactly — no
  // separate EMŠO field (the mockup has none) and "Št. ZZZS" is the one
  // insurance-card-style identifier, not a second "Št. zdravstvene
  // kartice" field alongside it. Fields are lifted into real state (not
  // uncontrolled defaultValue) since the view mode needs to render their
  // current value as plain text.
  const [editMode, setEditMode] = useState(false);
  const [patientInfo, setPatientInfo] = useState({
    spol: 'M' as 'M' | 'F' | '',
    terapevt: 'Monika Novak',
    dob: '1982-03-12',
    email: 'gregor.goslar@gmail.com',
    naslov: 'Spodnje Pirniče 41j',
    postalCode: '1215',
    kraj: 'Medvode',
    zzzs: '039303892',
    evidenca: '123456',
  });
  function updatePatientInfo<K extends keyof typeof patientInfo>(key: K, value: (typeof patientInfo)[K]) {
    setPatientInfo((prev) => ({ ...prev, [key]: value }));
  }
  // Notes: its own submit flow, independent of the Edit toggle above — the
  // spec lists "Notes field (submittable)" as its own bullet, distinct from
  // the Edit-toggled identity fields. Starts empty, matching the mockup's
  // own empty grey Opombe box.
  const [noteDraft, setNoteDraft] = useState('');
  const [noteLog, setNoteLog] = useState<{ date: string; text: string }[]>([]);

  function handleSubmitNote() {
    const text = noteDraft.trim();
    if (!text) return;
    setNoteLog((prev) => [{ date: new Date().toLocaleDateString('sl-SI'), text }, ...prev]);
    setNoteDraft('');
  }

  // Frame 3 (right column, bottom tabbed frame): Rentgeni/Fotografije/SMS/
  // E-pošta — modeled on the mockup's own frame, which sits here below
  // "Podrobnosti termina" rather than in the left column (the written spec
  // put it on the left; the actual SVG mockup disagrees, and per Gregor's
  // "model it the same way as the SVG" instruction for frame 2, the mockup
  // wins). "Rentgeni" defaults active, matching the mockup's own screenshot.
  const [infoTab, setInfoTab] = useState<'rentgeni' | 'fotografije' | 'sms' | 'eposta'>('rentgeni');
  const [rtgGalleryOpen, setRtgGalleryOpen] = useState(false);

  // Frame 5 (right column, appointment card): status is not user-selectable
  // (see MOCK_APPOINTMENT_STATUS's own comment for the real derivation
  // rules) — an earlier version had a dev-only selector here, removed per
  // Gregor's explicit request once the state machine itself was confirmed.
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<(typeof MOCK_INVOICES)[number] | null>(null);
  const unpaidInvoices = MOCK_INVOICES.filter((inv) => !inv.paid);
  const totalUnpaid = unpaidInvoices.reduce((sum, inv) => sum + inv.amount, 0);

  function redirectsSurfaceEditToWholeTooth(status: ToothStatus): boolean {
    return WHOLE_TOOTH_MARKER_STATUSES.includes(status) || hidesSurfaceDetail(status);
  }

  function handleWholeToothStatusChange(fdi: string, status: ToothStatus) {
    setSurfacesByFdi((prev) => ({ ...prev, [fdi]: { all: status } }));
  }

  function handleSurfaceStatusChange(fdi: string, surface: Surface, status: ToothStatus) {
    if (redirectsSurfaceEditToWholeTooth(status)) {
      handleWholeToothStatusChange(fdi, status);
      return;
    }
    setSurfacesByFdi((prev) => ({ ...prev, [fdi]: { ...prev[fdi], [surface]: status } }));
  }

  function applyStatusToTarget(target: Target, status: ToothStatus) {
    if (target.surface === 'all') handleWholeToothStatusChange(target.fdi, status);
    else handleSurfaceStatusChange(target.fdi, target.surface, status);
  }

  function isTargetSelected(fdi: string, surface: Surface | 'all'): boolean {
    return selection.some((t) => sameTarget(t, { fdi, surface }));
  }

  function isFdiSelected(fdi: string): boolean {
    return selection.some((t) => t.fdi === fdi);
  }

  function handleTargetClick(fdi: string, surface: Surface | 'all', e: MouseEvent) {
    const target: Target = { fdi, surface };
    const extend = e.ctrlKey || e.metaKey || e.shiftKey;
    setSelection((prev) => {
      const idx = prev.findIndex((t) => sameTarget(t, target));
      if (extend) return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, target];
      return [target];
    });
    setBridgeMessage(null);
  }

  function handleCreateBridge() {
    const fdis = [...new Set(selection.map((t) => t.fdi))];
    if (fdis.length < 2) {
      setBridgeMessage(
        'Za most izberite vsaj dva zoba skupaj — pridržite Ctrl (ali Cmd na Macu) med klikom na drugi zob, da ostane izbran tudi prvi.'
      );
      return;
    }
    const arch = ARCHES.find((a) => fdis.every((fdi) => a.includes(fdi)));
    if (!arch) {
      setBridgeMessage('Izbrani zobje morajo biti v isti čeljusti (zgornji ali spodnji).');
      return;
    }
    const anchors = fdis.filter((fdi) => {
      const status = surfacesByFdi[fdi]?.all;
      return status === 'crown' || status === 'implant';
    });
    if (anchors.length === 0) {
      setBridgeMessage('Izbira mora vsebovati zob, ki že ima prevleko ali implantat — most se pripne nanj.');
      return;
    }
    const anchorTypes = new Set(anchors.map((fdi) => surfacesByFdi[fdi]?.all));
    if (anchorTypes.size > 1) {
      setBridgeMessage('Oba sidra mostu morata biti istega tipa — obe prevleki ali oba implantata, ne kombinacija.');
      return;
    }
    const pontics = fdis.filter((fdi) => !anchors.includes(fdi));
    if (pontics.length === 0) {
      setBridgeMessage('Poleg prevleke/implantata izberite še vsaj en zob, ki naj postane člen mostu.');
      return;
    }
    setBridgeMessage(null);
    setSurfacesByFdi((prev) => {
      const next = { ...prev };
      for (const fdi of pontics) next[fdi] = { all: 'bridge_pontic' };
      return next;
    });
    const groupId = `bridge-${fdis.slice().sort().join('_')}-${Date.now()}`;
    setBridgeGroupByFdi((prev) => {
      const next = { ...prev };
      for (const fdi of fdis) next[fdi] = groupId;
      return next;
    });
  }

  function handleStatusClick(status: ToothStatus) {
    if (selection.length === 0) return;
    if (status === 'bridge_pontic') {
      handleCreateBridge();
      return;
    }
    selection.forEach((target) => applyStatusToTarget(target, status));
  }

  function handleClearSelection() {
    setSelection([]);
    setBridgeMessage(null);
  }

  // Escape clears the selection — the "Prekliči izbiro (Esc)" button
  // (frame 7) promises this shortcut, but it was never actually wired up
  // on this page (PatientChart.tsx has the real version this mirrors).
  // Guarded the same way: ignored while focus is in a text input/textarea
  // (Opombe, an edit-mode field) so Escape there doesn't also clear a
  // chart selection the user isn't even looking at.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'Escape') handleClearSelection();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  function handleTogglePost() {
    const fdis = [...new Set(selection.map((t) => t.fdi))];
    if (fdis.length === 0) return;
    const allHavePost = fdis.every((fdi) => postByFdi[fdi]);
    setPostByFdi((prev) => {
      const next = { ...prev };
      for (const fdi of fdis) next[fdi] = !allHavePost;
      return next;
    });
  }

  function handleSetEndoStage(stage: EndoStage) {
    const fdis = [...new Set(selection.map((t) => t.fdi))];
    if (fdis.length === 0) return;
    const allHaveStage = fdis.every((fdi) => endoByFdi[fdi] === stage);
    setEndoByFdi((prev) => {
      const next = { ...prev };
      for (const fdi of fdis) {
        if (allHaveStage) delete next[fdi];
        else next[fdi] = stage;
      }
      return next;
    });
  }

  const selectedHistory = selectedFdi ? MOCK_TOOTH_HISTORY[selectedFdi] : undefined;

  // Extracted so the exact same content can be rendered at two different
  // responsive positions — per Gregor's explicit request to regroup
  // "Podrobnosti termina" with "Pretekli termini" (instead of Rentgeni)
  // specifically below 1400px, while the original grouping (Podrobnosti+
  // Rentgeni on the right, Pretekli+patient info on the left) stays
  // untouched at >=1400px. Each renders twice below — once inside its
  // original wide-mode wrapper (hidden below 1400px), once inside a new
  // narrow-only pairing wrapper (hidden at >=1400px) — rather than two
  // independently-maintained copies of the same markup.
  const appointmentCardContent = (
    <>
      <h2 className="mb-3 text-lg font-bold text-[var(--ink,#1c2624)]">Podrobnosti termina</h2>
      <div className="flex items-start justify-between gap-3">
        {/* Left: status pill (not clickable — see
            MOCK_APPOINTMENT_STATUS's own comment above), the
            schedule/reschedule button in that same slot either way,
            and — for every status except "Ni termina" — the booked
            appointment's own details below that. */}
        <div className="flex flex-1 flex-col items-start gap-2">
          <span
            className={`w-fit rounded-full px-4 py-1.5 text-sm font-semibold ${APPOINTMENT_STATUS_META[MOCK_APPOINTMENT_STATUS].pillClass}`}
          >
            {APPOINTMENT_STATUS_META[MOCK_APPOINTMENT_STATUS].label}
          </span>

          {MOCK_APPOINTMENT_STATUS === 'ni_termina' ? (
            <button
              type="button"
              onClick={() => setScheduleModalOpen(true)}
              className="w-fit rounded-full bg-[var(--accent,#2e6e62)] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              Naroči naslednji termin
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setRescheduleModalOpen(true)}
              className="w-fit rounded-full bg-[var(--accent,#2e6e62)] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              Prestavi termin
            </button>
          )}

          {MOCK_APPOINTMENT_STATUS !== 'ni_termina' && (
            <div className="flex flex-col gap-1 text-sm text-[var(--ink,#1c2624)]">
              <span>Datum: 14. 3. 2026</span>
              <span>Ura: 10:30</span>
              <span>Predvidena storitev: Pregled + čiščenje</span>
            </div>
          )}
        </div>

        {/* Right: unpaid-invoices indicator — "same frame, to the
            right" per the spec. */}
        <div className="flex w-[150px] flex-none flex-col gap-1.5">
          {unpaidInvoices.length > 0 ? (
            <>
              <span className="w-fit rounded-full bg-[#e0231c] px-3 py-1 text-xs font-semibold text-white">
                Neplačani račun
              </span>
              <ul className="flex flex-col gap-1">
                {unpaidInvoices.map((inv) => (
                  <li key={inv.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(inv)}
                      className="w-full rounded border border-[var(--line,#ccd6d4)] px-2 py-1 text-left text-xs text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]"
                    >
                      <div className="font-medium">{inv.date}</div>
                      <div className="text-[var(--muted,#6f7c79)]">{inv.amount.toFixed(2)} €</div>
                    </button>
                  </li>
                ))}
              </ul>
              <span className="mt-1 text-xs font-semibold text-[var(--ink,#1c2624)]">
                Skupaj: {totalUnpaid.toFixed(2)} €
              </span>
            </>
          ) : (
            <span className="w-fit rounded-full bg-[#4CAF50] px-3 py-1 text-xs font-medium text-white">
              Računi plačani
            </span>
          )}
        </div>
      </div>
    </>
  );

  const visitHistoryContent = (
    <>
      <h2 className="mb-3 flex-none text-xl font-bold text-[var(--ink,#1c2624)]">Pretekli termini in storitve</h2>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {MOCK_VISIT_HISTORY.map((visit, i) => (
          <li key={i} className="flex-none rounded-md bg-[#e7e7e7] p-3">
            <span className="font-mono text-xs text-[var(--muted,#6f7c79)]">{visit.date}</span>
            <ul className="mt-1 flex flex-col gap-0.5 text-sm text-[var(--ink,#1c2624)]">
              {visit.storitve.map((s, j) => (
                <li key={j}>• {s}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );

  // Same sharing pattern as appointmentCardContent/visitHistoryContent
  // above — this card's content also needs to render at two different
  // positions below 1400px (nested under the chart, beside Legenda) vs.
  // >=1400px (its original spot in the right column, unchanged).
  const rentgeniCardContent = (
    <>
      <div className="mb-3 flex flex-none items-center justify-between border-b border-[var(--line,#ccd6d4)]">
        <div className="flex gap-1">
          {(
            [
              ['rentgeni', 'Rentgeni'],
              ['fotografije', 'Fotografije'],
              ['sms', 'SMS'],
              ['eposta', 'E-pošta'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setInfoTab(key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                infoTab === key
                  ? 'border-[var(--accent,#2e6e62)] text-[var(--accent,#2e6e62)]'
                  : 'border-transparent text-[var(--ink-soft,#45524f)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {infoTab === 'rentgeni' && (
          <button
            type="button"
            onClick={() => setRtgGalleryOpen(true)}
            className="mb-2 flex-none rounded-full border border-[var(--ink,#1c2624)] px-3 py-1 text-xs font-semibold text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)] hover:text-[var(--accent,#2e6e62)]"
          >
            RTG galerija
          </button>
        )}
      </div>

      {infoTab === 'rentgeni' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <p className="flex-none text-xs italic text-[var(--muted,#6f7c79)]">
            Mockup — slike bi se sem prenesle samodejno iz RTG aparata/studia. Prikazan je najnovejši posnetek.
          </p>
          <div className="flex w-full flex-1 items-center justify-center rounded-md bg-[#e7e7e7] text-sm text-[var(--muted,#6f7c79)]">
            {MOCK_RTG_GALLERY[0].opis} · {MOCK_RTG_GALLERY[0].date}
          </div>
        </div>
      )}

      {infoTab === 'fotografije' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <p className="flex-none text-xs italic text-[var(--muted,#6f7c79)]">
            Mockup — klinične fotografije, ki jih zdravnik naloži med zdravljenjem.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {MOCK_PHOTOS.map((photo, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex aspect-square w-full items-center justify-center rounded-md bg-[#e7e7e7] text-xs text-[var(--muted,#6f7c79)]">
                  {photo.opis}
                </div>
                <span className="text-xs text-[var(--muted,#6f7c79)]">{photo.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {infoTab === 'sms' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <p className="flex-none text-xs italic text-[var(--muted,#6f7c79)]">Mockup — zadnje SMS sporočilo s pacientom.</p>
          <div className="rounded-md bg-[#e7e7e7] p-3 text-sm text-[var(--ink,#1c2624)]">
            <p>{MOCK_SMS.text}</p>
            <p className="mt-2 text-xs text-[var(--muted,#6f7c79)]">{MOCK_SMS.date}</p>
          </div>
        </div>
      )}

      {infoTab === 'eposta' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <p className="flex-none text-xs italic text-[var(--muted,#6f7c79)]">Mockup — kronološka zgodovina e-pošte s pacientom.</p>
          <ul className="flex flex-col gap-2">
            {MOCK_EMAILS.map((email, i) => (
              <li key={i} className="rounded-md bg-[#e7e7e7] p-3 text-sm text-[var(--ink,#1c2624)]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{email.subject}</span>
                  <span className="flex-none text-xs text-[var(--muted,#6f7c79)]">{email.date}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted,#6f7c79)]">{email.snippet}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  return (
    <>
      <AppNavShell />
      {/* Space above the banner and below it both set to the same 6px, per
          Gregor's explicit request (a first pass halved them independently
          — 8px/6px — and left them slightly mismatched). */}
      <div className="flex w-full flex-col gap-1.5 pb-4 pt-1.5">
      <style>{PHONE_COMPACT_CSS}</style>
      {/* Row 1: back button + health-questionnaire alert banner — entirely
          illustrative, see the file-level comment above. Keeps its own
          small horizontal inset even though the three columns below now
          run edge-to-edge (per Gregor's explicit request) — this row isn't
          one of "the three columns," so nothing forces it to also touch
          the screen edges, and a bare-flush banner/back-button read worse. */}
      <div className="flex items-center gap-4 px-4">
        <button
          type="button"
          className="flex-none text-sm text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
        >
          ← Nazaj na seznam pacientov
        </button>
        <div className="flex flex-1 items-center gap-4 rounded-md bg-[#e0231c] px-4 py-2 text-sm font-bold text-white">
          {/* Three equal-width columns, each left-aligned within its own
              third, spanning the full space from the banner's own left edge
              to the "(mockup...)" note / Vprašalnik button on the right —
              per Gregor's explicit request for genuinely equal
              distribution, not just equal gaps (justify-between, tried
              first, anchors the first/last items to the two edges
              instead). */}
          <div className="grid flex-1 grid-cols-3 items-center gap-4 text-left">
            <span>Alergije: penicilin</span>
            <span>Akutna stanja: povišan krvni tlak</span>
            <span>Zdravila: Lisinopril 10mg</span>
          </div>
          <span className="flex-none text-xs font-normal italic text-white/80">
            (mockup — iz vprašalnika o zdravju)
          </span>
          <button
            type="button"
            onClick={() => setQuestionnaireOpen(true)}
            className="flex-none rounded-full bg-white px-4 py-1.5 text-xs font-bold text-[#e0231c] hover:bg-white/90"
          >
            Vprašalnik
          </button>
        </div>
      </div>

      {questionnaireOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setQuestionnaireOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">Vprašalnik o zdravju</h2>
              <button
                type="button"
                onClick={() => setQuestionnaireOpen(false)}
                className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
              >
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm italic text-[var(--muted,#6f7c79)]">
              Mockup — tu bo prikazan celoten izpolnjen vprašalnik pacienta (odgovori o alergijah, kroničnih
              boleznih, zdravilih, preteklih operacijah ipd.).
            </p>
            <div className="flex flex-col gap-3 text-sm text-[var(--ink,#1c2624)]">
              <div>
                <span className="font-semibold">Alergije: </span>
                penicilin
              </div>
              <div>
                <span className="font-semibold">Kronične bolezni / akutna stanja: </span>
                povišan krvni tlak
              </div>
              <div>
                <span className="font-semibold">Zdravila: </span>
                Lisinopril 10mg
              </div>
              <div>
                <span className="font-semibold">Datum izpolnitve: </span>
                4. 1. 2023
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Column widths: 1:2:1 ratio (patient data : dental chart : Rentgeni
          etc.) — the fr-based track sizes re-portion themselves against
          whatever width is actually available, so the 12px left/right
          margins below don't need any separate ratio recalculation to
          preserve 1:2:1.
          minmax(0, …fr), not bare …fr — a bare fr track's implicit
          minimum is its content's own min-content size, so wide-enough
          content (the fitWidth dental chart below, which sizes itself
          off *this same column's* measured width) can grow the track
          past its intended fr share, squeezing the other two columns —
          exactly the runaway feedback loop Gregor caught live once
          fitWidth was added. minmax(0, …fr) pins each track to its
          fr-proportional share regardless of content size. */}
      {/* PROTOTYPE — responsive reflow, not yet confirmed as final (see
          Gregor's "make this page dynamic" request). Below 1400px:
           - Patient info becomes its own full-width bar above the chart
             (its field grid widens from 2 to 4 columns to actually use
             that width, rather than staying a tall narrow sidebar block)
           - The dental chart is capped at CHART_MAX_WIDTH (matching its
             own natural size in the 17"+ 2fr column) instead of stretching
             to fill the full row — Gregor's explicit "don't make it
             bigger than the 17\" version" correction after the first
             full-width-chart prototype rendered it oversized.
           - Pretekli termini + the appointment/Rentgeni column drop into a
             2-column row below that.
          At >=1400px this collapses back to the exact original 1:2:1
          side-by-side grid (left column = patient info stacked above
          Pretekli termini, exactly as before) — via `order`/`col-span` on
          the existing columns plus `contents` on the left-column wrapper
          (to let patient info and Pretekli termini become independent grid
          items only below 1400px), no DOM restructuring, so nothing
          changes for 15"+ screens. */}
      <div className="grid grid-cols-1 items-start gap-3 px-3 sm:grid-cols-2 min-[1400px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
        {/* ---- Left column: identity/contact fields + past appointments ----
            `contents` below 1400px dissolves this wrapper so its two
            children (patient info, Pretekli termini) become independent
            grid items — patient info moves above the chart (order-0,
            full width), Pretekli termini pairs with the right column
            below (order-2). At >=1400px this becomes a real flex column
            again (order-1), reconstructing the original stacked-sidebar
            layout exactly. */}
        <div className="contents min-[1400px]:order-1 min-[1400px]:flex min-[1400px]:flex-col min-[1400px]:gap-3">
          <div className="order-0 flex flex-col gap-2 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4 sm:col-span-2 min-[1400px]:col-span-1 min-[1400px]:gap-4">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-3xl font-bold text-[var(--ink,#1c2624)]">Goslar Gregor</h1>
              <button
                type="button"
                onClick={() => setEditMode((v) => !v)}
                className={
                  editMode
                    ? 'flex-none rounded-full bg-[var(--accent,#2e6e62)] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90'
                    : 'flex-none rounded-full border border-[var(--ink,#1c2624)] px-5 py-1.5 text-sm font-semibold text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)] hover:text-[var(--accent,#2e6e62)]'
                }
              >
                {editMode ? 'Shrani' : 'Uredi'}
              </button>
            </div>

            {/* Two-column field grid — view mode renders plain label/value
                text (no boxes), matching the mockup's read view exactly;
                edit mode swaps the value line for a real input.
                sm:grid-cols-4 (below 1400px only, where this card is a
                full-width bar via col-span-2 above) spreads the same 8
                fields across 2 rows of 4 instead of 4 rows of 2 — using
                the width Gregor asked for instead of staying a tall
                narrow block once there's room to spread out. Reverts to
                the original 2-column layout at >=1400px, where this card
                is back to being a narrow sidebar. gap-y-1 (below 1400px
                only) tightens the vertical space between field rows per
                Gregor's explicit request — restored to the original
                gap-y-3 at >=1400px. */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4 min-[1400px]:grid-cols-2 min-[1400px]:gap-y-3">
              <div className="flex flex-col gap-1">
                <span className={VIEW_LABEL_CLASSES}>Spol</span>
                {editMode ? (
                  <select
                    value={patientInfo.spol}
                    onChange={(e) => updatePatientInfo('spol', e.target.value as 'M' | 'F' | '')}
                    className={FIELD_INPUT_CLASSES}
                  >
                    <option value="">Neznano</option>
                    <option value="F">Ženski</option>
                    <option value="M">Moški</option>
                  </select>
                ) : (
                  <span className={VIEW_VALUE_CLASSES}>{GENDER_LABELS[patientInfo.spol]}</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className={VIEW_LABEL_CLASSES}>Izbran terapevt</span>
                {editMode ? (
                  <input
                    value={patientInfo.terapevt}
                    onChange={(e) => updatePatientInfo('terapevt', e.target.value)}
                    className={FIELD_INPUT_CLASSES}
                  />
                ) : (
                  <span className={VIEW_VALUE_CLASSES}>{patientInfo.terapevt}</span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <span className={VIEW_LABEL_CLASSES}>Datum rojstva</span>
                {editMode ? (
                  // Plain text, not <input type="date"> — a native date
                  // input's calendar-icon chrome carries its own minimum
                  // height that can't be zeroed via padding/border like the
                  // other fields here, which broke the fixed-536px height
                  // requirement by a few px. ISO format (yyyy-mm-dd) while
                  // editing; formatSlovenianDate() still renders the
                  // friendly form in view mode.
                  <input
                    value={patientInfo.dob}
                    onChange={(e) => updatePatientInfo('dob', e.target.value)}
                    placeholder="LLLL-MM-DD"
                    className={FIELD_INPUT_CLASSES}
                  />
                ) : (
                  <span className={VIEW_VALUE_CLASSES}>{formatSlovenianDate(patientInfo.dob)}</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className={VIEW_LABEL_CLASSES}>E-pošta</span>
                {editMode ? (
                  <input
                    type="email"
                    value={patientInfo.email}
                    onChange={(e) => updatePatientInfo('email', e.target.value)}
                    className={FIELD_INPUT_CLASSES}
                  />
                ) : (
                  <span className={VIEW_VALUE_CLASSES}>{patientInfo.email}</span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <span className={VIEW_LABEL_CLASSES}>Naslov</span>
                {editMode ? (
                  // No gap between the two stacked rows here (unlike most
                  // other multi-row groups in this card) — the view-mode
                  // text above is two plain lines with no space between
                  // them either (a single <span> with a <br/>), and this
                  // card's fixed-536px height leaves no room to spare.
                  <div className="flex flex-col">
                    <input
                      value={patientInfo.naslov}
                      onChange={(e) => updatePatientInfo('naslov', e.target.value)}
                      className={FIELD_INPUT_CLASSES}
                    />
                    <div className="flex gap-1.5">
                      <input
                        value={patientInfo.postalCode}
                        onChange={(e) => updatePatientInfo('postalCode', e.target.value)}
                        inputMode="numeric"
                        placeholder="Poštna št."
                        className={FIELD_INPUT_CLASSES + ' w-20'}
                      />
                      <input
                        value={patientInfo.kraj}
                        onChange={(e) => updatePatientInfo('kraj', e.target.value)}
                        placeholder="Kraj"
                        className={FIELD_INPUT_CLASSES + ' flex-1'}
                      />
                    </div>
                  </div>
                ) : (
                  <span className={VIEW_VALUE_CLASSES}>
                    {patientInfo.naslov}
                    <br />
                    {patientInfo.postalCode} {patientInfo.kraj}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className={VIEW_LABEL_CLASSES}>Telefonska številka</span>
                {editMode ? (
                  <div className="ppm-phone-compact w-full shadow-[0_1px_0_0_var(--line,#ccd6d4)]">
                    <PhoneInput defaultCountry="SI" value={phone} onChange={(v) => setPhone(v ?? '')} />
                  </div>
                ) : (
                  <span className={VIEW_VALUE_CLASSES}>{phone}</span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <span className={VIEW_LABEL_CLASSES}>Št. ZZZS</span>
                {editMode ? (
                  <input
                    value={patientInfo.zzzs}
                    onChange={(e) => updatePatientInfo('zzzs', e.target.value)}
                    inputMode="numeric"
                    className={FIELD_INPUT_CLASSES}
                  />
                ) : (
                  <span className={VIEW_VALUE_CLASSES}>{patientInfo.zzzs}</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className={VIEW_LABEL_CLASSES}>Št. interne evidence</span>
                {editMode ? (
                  <input
                    value={patientInfo.evidenca}
                    onChange={(e) => updatePatientInfo('evidenca', e.target.value)}
                    className={FIELD_INPUT_CLASSES}
                  />
                ) : (
                  <span className={VIEW_VALUE_CLASSES}>{patientInfo.evidenca}</span>
                )}
              </div>
            </div>

            {/* Opombe: its own submit flow, independent of the Edit toggle
                above — the spec lists "Notes field (submittable)" as its
                own bullet, distinct from the Edit-toggled identity fields.
                Single grey box (#D2D0CA, sampled off the mockup) with
                "Shrani" floating inside its bottom-right corner, same as
                the mockup — not a bordered textarea + separate button row.
                Below 1400px only (per Gregor's explicit request): the
                textarea shrinks to one line and "Shrani" moves beside it
                instead of floating inside it — a 1-line box is too short
                for an absolute-positioned button to sit inside without
                colliding with typed text. h-10/pb-2 (narrow) vs. the
                original rows=4-driven height/pb-12 (>=1400px, via
                min-[1400px]:h-auto letting the rows attribute govern
                height again) restore the exact original look at desktop
                size. */}
            <div className="flex flex-col gap-1">
              <span className={VIEW_LABEL_CLASSES}>Opombe</span>
              <div className="flex items-stretch gap-2 min-[1400px]:relative min-[1400px]:block">
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Dodaj opombo o pacientu…"
                  rows={4}
                  className="h-10 w-full resize-none rounded-xl border-none bg-[#d2d0ca] px-3 py-2 text-[var(--ink,#1c2624)] placeholder:text-[var(--ink,#1c2624)]/50 min-[1400px]:h-auto min-[1400px]:pb-12"
                />
                <button
                  type="button"
                  onClick={handleSubmitNote}
                  disabled={!noteDraft.trim()}
                  className="flex-none self-center rounded-full bg-[#1800ad] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 min-[1400px]:absolute min-[1400px]:bottom-3 min-[1400px]:right-3 min-[1400px]:self-auto"
                >
                  Shrani
                </button>
              </div>
              {noteLog.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1.5 border-t border-[var(--line,#ccd6d4)] pt-2">
                  {noteLog.map((entry, i) => (
                    <li key={i} className="flex gap-3 text-sm text-[var(--ink,#1c2624)]">
                      <span className="w-20 flex-none font-mono text-xs text-[var(--muted,#6f7c79)]">{entry.date}</span>
                      <span>{entry.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ---- Frame 8: chronological visit history, newest first ----
              Fixed height, 271px — re-anchored to Frame 7's own natural
              (unpadded) bottom edge, per Gregor's explicit follow-up:
              shrink the taller frames down to match the shortest one's
              real content height, rather than growing the shorter ones
              up to a taller one. This also lowers the page's own total
              height (unlike the earlier "grow to match Frame 3" version),
              which is the whole point — fewer px to scroll through.
              hidden below 1400px (min-[1400px]:flex restores it) — per
              Gregor's later request to pair this with "Podrobnosti
              termina" instead of patient info below 1400px, it now
              renders in a NEW wrapper further down instead (see
              "Narrow-only pairing" below); this, its original position,
              stays for >=1400px only, unchanged. */}
          <div className="hidden h-[271px] flex-col rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4 min-[1400px]:flex">
            {visitHistoryContent}
          </div>
        </div>

        {/* ---- Middle column: the real, clickable chart + status toolbar + tabs ----
            gap-1.5 (was gap-3) between the chart and Frame 7 below it at
            >=1400px — tightened per Gregor's explicit request, freeing a
            few more px toward the bottom-alignment goal. Below 1400px
            (sm: up to 1399px — kept off below the sm breakpoint too, so a
            genuinely tiny window still stacks safely instead of forcing
            a fixed-990px chart into a row it can't fit): flex-row instead
            of flex-col, per Gregor's explicit request to stop wasting the
            blank margin beside the width-capped chart — Frame 7
            (Legenda/Storitve, below) becomes its right-hand neighbor
            instead of sitting stacked underneath it. order-1/col-span-2
            below 1400px is the reflow prototype above — full-width top
            row instead of the narrow middle third; unaffected by this
            row/column change, which only governs this div's OWN two
            children. */}
        <div className="order-1 flex flex-col gap-1.5 sm:col-span-2 sm:flex-row sm:items-start sm:gap-3 min-[1400px]:order-2 min-[1400px]:col-span-1 min-[1400px]:flex-col min-[1400px]:gap-1.5">
          {/* Groups the chart with the three bottom cards (below 1400px
              only) so they sit directly beneath the CHART's own shorter
              height, not the whole chart+Legenda row's height — per
              Gregor's explicit follow-up request. Without this wrapper,
              Podrobnosti termina/Pretekli termini/Rentgeni sat in a
              separate grid row whose start position was pushed down by
              Legenda's own height (964px, taller than the chart's 614px),
              since both the chart AND Legenda lived in that first row
              together — a big, unwanted gap below the visibly-shorter
              chart. Nesting the bottom cards here instead, as a sibling
              of the chart within the SAME flex-column (not a new grid
              row), means they start right after the chart's own actual
              bottom edge, independent of however tall Legenda happens to
              be alongside them. sm:flex-none (not flex-1): this stack's
              own width must come from its content (990px, via the
              chart's own cap below), not from splitting space evenly with
              Legenda — Legenda alone takes sm:flex-1 to fill whatever's
              left, exactly as it already did before this wrapper existed.
              min-[1400px]:contents dissolves this wrapper at >=1400px, so
              only the chart itself sits here then, unchanged from before
              any of today's narrow-mode work. */}
          <div className="flex flex-col gap-3 sm:flex-none min-[1400px]:contents">
          {/* Capped at 990px ONLY below 1400px (max-[1399px]:, not a plain
              max-w-*) — per Gregor's explicit correction after the first
              full-width-chart prototype: below 1400px this column spans
              the full page width, but the chart itself should stay the
              same size it renders at on his real desktop screen, not grow
              to fill the extra space. 990px is his actual measured card
              width there (ruler screenshot: ~2046px real browser width ->
              natural fitWidth column ~990px) — NOT a generic "17-inch"
              guess; an earlier version used 769px, derived from an assumed
              1600px-wide reference screen that didn't match his real
              window, which is why the two didn't visually match. Scoping
              the cap to max-[1399px]: is what matters structurally — an
              earlier version applied it unconditionally, which then ALSO
              clamped the chart at >=1400px on any screen wider than the
              assumed reference, silently undoing fitWidth's actual job
              there (breaking the exact "fill this column" behavior
              fitWidth has always had on normal/desktop screens). At
              >=1400px this div is just a plain full-width wrapper — no
              cap, chart fills the real column exactly as before today's
              changes (so it'll still exceed 990px on a real screen wider
              than ~2046px logical px — this pins the 13" case to Gregor's
              own current desktop size specifically, not a hard app-wide
              ceiling). fitWidth still does its normal job of scaling the
              chart to exactly fill whatever container it's given.
              sm:flex-none + sm:mx-0: from the sm breakpoint up to 1399px
              this div is a row-sibling of Frame 7 (see the parent's own
              comment above) rather than centered above it, so it needs to
              stay pinned at its capped width instead of flex-shrinking or
              auto-centering; harmless at >=1400px, where the parent is
              flex-col again and this was already effectively a no-op
              (mx-auto on a w-full block has no visible effect). */}
          <div className="mx-auto w-full max-[1399px]:max-w-[990px] sm:mx-0 sm:flex-none">
            <DentalChart
              instructionText={
                <div className="flex items-center justify-between gap-3">
                  {/* Left side switches from the idle prompt to "Izbran zob: …"
                      once a tooth is selected — per Gregor's explicit request.
                      Right side is a static hint, matching the mockup's own
                      header row exactly ("Za vnos globine žepka..."). */}
                  <span>{selectedFdi ? `Izbran zob: ${selectedFdi}` : 'Kliknite na zob za izbiro in urejanje statusa/storitev spodaj.'}</span>
                  <span>Za vnos globine žepka ali umika dlesni kliknite eno od točk ob zobeh.</span>
                </div>
              }
              surfacesByFdi={surfacesByFdi}
              pocketsBuccal={MOCK_POCKETS_BUCCAL}
              pocketsLingual={MOCK_POCKETS_LINGUAL}
              gumMargin={MOCK_GUM_MARGIN}
              bleedingBuccal={MOCK_BLEEDING_BUCCAL}
              bleedingLingual={MOCK_BLEEDING_LINGUAL}
              postByFdi={postByFdi}
              endoByFdi={endoByFdi}
              bridgeGroupByFdi={bridgeGroupByFdi}
              onSelect={setSelectedFdi}
              onTargetClick={handleTargetClick}
              isTargetSelected={isTargetSelected}
              isFdiSelected={isFdiSelected}
              hideArchLabels
              compact
              fitWidth
            />
          </div>

          {/* Podrobnosti termina + Pretekli termini (left) and Rentgeni/
              Fotografije/SMS/E-pošta (right) — below 1400px only (hidden,
              sm:flex restores it, min-[1400px]:hidden takes it away again
              once each card's ORIGINAL >=1400px position — inside the
              patient-info column and the appointment column respectively
              — takes over instead). Content is shared with those original
              positions via appointmentCardContent/visitHistoryContent/
              rentgeniCardContent (declared above, near selectedHistory) —
              this is a second rendering at a different position, not a
              second copy to maintain. Both sides sm:flex-1/sm:min-w-0 to
              split the chart's own 990px width evenly, per Gregor's
              explicit request that these three frames shrink to fit
              "the gap between the left edge of the screen and Legenda." */}
          <div className="hidden flex-col gap-3 sm:flex sm:flex-row sm:items-start sm:gap-3 min-[1400px]:hidden">
            <div className="flex flex-col gap-3 sm:min-w-0 sm:flex-1">
              <div className="rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">{appointmentCardContent}</div>
              <div className="flex h-[271px] flex-col rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">
                {visitHistoryContent}
              </div>
            </div>
            <div className="flex h-[589px] flex-col rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4 sm:min-w-0 sm:flex-1">
              {rentgeniCardContent}
            </div>
          </div>
          </div>

          {/* ---- Frame 7: Legenda/Storitve po zobeh, merged with the
              status toolbar ----
              Back to natural/auto height (no fixed height) — Gregor chose
              the "shrink the taller frames down to this one's natural
              height" side of the trade-off instead of growing this one to
              match Frame 3, per his follow-up. Frame 8 and Frame 3 are
              now the ones sized to match THIS card's own bottom edge.
              sm:flex-1/sm:min-w-0 (below 1400px only): fills the width
              freed up beside the now-left-aligned, width-capped chart
              (see the parent's own comment) instead of sitting stacked
              full-width below it — min-w-0 lets it actually shrink to
              that narrower space rather than overflowing based on its
              own content's natural width (StatusToolbar's button grid).
              Reset at >=1400px, where this is back to a normal full-width
              block stacked below the chart, unchanged. */}
          <div className="flex flex-col rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4 sm:min-w-0 sm:flex-1 min-[1400px]:flex-none min-[1400px]:w-full">
            {/* "Legenda" (holding the clickable status toolbar, moved out
                of its own standalone row above this card, instead of the
                old read-only StatusLegend swatch grid — that grid and the
                toolbar's own buttons showed every service twice, per
                Gregor's explicit feedback) is the first/default tab.
                The toolbar's own header block — both the idle-state
                prompt AND the "n izbranih… / Prekliči izbiro" pair once
                something's selected — is hidden (hideHeader) and
                re-rendered right here instead, on the same line as the
                tab buttons, right-aligned to this card's own right edge,
                and (per Gregor's explicit request) kept on one line even
                in the "n izbranih" state rather than stacking the message
                above the button. Pulling both states up out of the tab
                panel below is what keeps this whole card short enough
                that the page doesn't need a scroll to see the rest of
                it. */}
            {/* Row below 1400px only became a genuine bug, not just an
                aesthetic choice: with justify-between + a flex-none hint
                span (see below), the header tried to lay the tabs AND the
                full one-line "Kliknite ploskev..." sentence out
                side-by-side even in this card's new ~237px-wide row-mode
                slot, forcing real horizontal overflow (page scrollWidth
                blew out to 1642px on a 1280px viewport before this fix).
                flex-col + items-stretch below 1400px stacks the tabs above
                the hint/selection line and gives it the card's full width
                to actually wrap into, instead of demanding one line
                beside the tabs. Reverts to the original single-row layout
                at >=1400px, where this card is wide enough for it. */}
            <div className="mb-3 flex flex-none flex-col items-stretch gap-2 border-b border-[var(--line,#ccd6d4)] min-[1400px]:flex-row min-[1400px]:items-center min-[1400px]:justify-between min-[1400px]:gap-3">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('legenda')}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                    activeTab === 'legenda'
                      ? 'border-[var(--accent,#2e6e62)] text-[var(--accent,#2e6e62)]'
                      : 'border-transparent text-[var(--ink-soft,#45524f)]'
                  }`}
                >
                  Legenda
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('storitve')}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                    activeTab === 'storitve'
                      ? 'border-[var(--accent,#2e6e62)] text-[var(--accent,#2e6e62)]'
                      : 'border-transparent text-[var(--ink-soft,#45524f)]'
                  }`}
                >
                  Storitve po zobeh
                </button>
              </div>
              {activeTab === 'legenda' && (
                // flex-none was the actual root cause of the overflow this
                // whole block's own comment above describes — it forced
                // this row to render at its full unshrunk content width
                // (the entire "Kliknite ploskev..." sentence on one line)
                // regardless of how little space the now-narrow card
                // actually had. flex-wrap (below 1400px) lets it wrap
                // instead; min-[1400px]:flex-none/flex-nowrap restores the
                // original fixed one-line-beside-the-tabs behavior once
                // there's actually room for it.
                <div className="mb-2 flex flex-wrap items-center gap-2 min-[1400px]:flex-none min-[1400px]:flex-nowrap">
                  {selection.length > 0 ? (
                    <>
                      <span className="text-xs text-[var(--ink,#1c2624)]">
                        <strong>{selection.length}</strong>{' '}
                        {selection.length === 1 ? 'izbrana ploskev/zob' : 'izbranih'} — kliknite status za uporabo.
                      </span>
                      <button
                        type="button"
                        onClick={handleClearSelection}
                        className="flex-none rounded border border-[var(--line,#ccd6d4)] px-2 py-1 text-xs text-[var(--ink-soft,#45524f)]"
                      >
                        Prekliči izbiro (Esc)
                      </button>
                    </>
                  ) : (
                    <span className="text-right text-xs text-[var(--ink-soft,#45524f)]">
                      Kliknite ploskev ali cel zob na karti (Ctrl/Cmd za več), nato status spodaj za uporabo.
                    </span>
                  )}
                </div>
              )}
            </div>

            {activeTab === 'legenda' && (
              <StatusToolbar
                bare
                hideHeader
                className="w-full"
                selectionCount={selection.length}
                onStatusClick={handleStatusClick}
                onClearSelection={handleClearSelection}
                onTogglePost={handleTogglePost}
                onSetEndoStage={handleSetEndoStage}
                bridgeMessage={bridgeMessage}
              />
            )}

            {activeTab === 'storitve' && (
              <div className="max-h-[220px] overflow-y-auto">
                {!selectedFdi && (
                  <p className="text-sm italic text-[var(--muted,#6f7c79)]">
                    Kliknite zob na karti zgoraj, da vidite kronološko zgodovino storitev.
                  </p>
                )}
                {selectedFdi && (
                  <div>
                    <h3 className="mb-2 font-semibold text-[var(--ink,#1c2624)]">Zob {selectedFdi}</h3>
                    {!selectedHistory || selectedHistory.length === 0 ? (
                      <p className="text-sm italic text-[var(--muted,#6f7c79)]">
                        Ni zabeleženih storitev za ta zob. (mockup — zgodovina še ni resnična funkcija)
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {selectedHistory.map((entry, i) => (
                          <li key={i} className="flex gap-3 text-sm text-[var(--ink,#1c2624)]">
                            <span className="w-24 flex-none font-mono text-xs text-[var(--muted,#6f7c79)]">{entry.date}</span>
                            <span>{entry.opis}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ---- Right column: appointment details + resource links ----
            Hidden entirely below 1400px (min-[1400px]:flex restores it) —
            per Gregor's explicit request, both cards now render nested
            under the chart instead (see the new block right after the
            chart above) at that size. Content is shared via
            appointmentCardContent/rentgeniCardContent (declared above,
            near selectedHistory) — this is those same cards' ORIGINAL
            position, unchanged from before any of today's narrow-mode
            work, not a second copy to maintain. */}
        <div className="order-3 hidden flex-col gap-3 min-[1400px]:flex">
          <div className="rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">{appointmentCardContent}</div>

          {/* Rentgeni/Fotografije/SMS/E-pošta — modeled on
              design/PatientRecordMockup.svg, which places this frame here
              in the right column below "Podrobnosti termina" (the written
              spec put it in the left column instead; the mockup wins per
              Gregor's "model it the same way" instruction for this page).
              Fixed height, originally 492px (pixel-matched to the
              Rentgeni tab's own natural height, the tallest of the four),
              then grown to 618px to match an earlier, taller version of
              Frame 8/Frame 7 — now 589px instead, shrunk back down to
              match Frame 7's own natural (shortest) bottom edge per
              Gregor's explicit follow-up request (shrink the taller
              frames to the shortest one's real content height, instead
              of growing the shorter ones up). */}
          <div className="flex h-[589px] flex-col rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">
            {rentgeniCardContent}
          </div>
        </div>
      </div>

      {rtgGalleryOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setRtgGalleryOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">RTG galerija</h2>
              <button
                type="button"
                onClick={() => setRtgGalleryOpen(false)}
                className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
              >
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm italic text-[var(--muted,#6f7c79)]">
              Mockup — tu bo prikazana celotna RTG galerija pacienta.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {MOCK_RTG_GALLERY.map((img, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md bg-[#e7e7e7] text-xs text-[var(--muted,#6f7c79)]">
                    {img.opis}
                  </div>
                  <span className="text-xs text-[var(--muted,#6f7c79)]">{img.date}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {scheduleModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setScheduleModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">Naroči naslednji termin</h2>
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
              >
                ✕
              </button>
            </div>
            <p className="text-sm italic text-[var(--muted,#6f7c79)]">
              Mockup — tu bo obrazec za naročanje naslednjega termina (datum, ura, predvidena storitev), povezan s
              koledarjem.
            </p>
          </div>
        </div>
      )}

      {rescheduleModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setRescheduleModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">Prestavi termin</h2>
              <button
                type="button"
                onClick={() => setRescheduleModalOpen(false)}
                className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
              >
                ✕
              </button>
            </div>
            <p className="text-sm italic text-[var(--muted,#6f7c79)]">
              Mockup — tu bo obrazec za prestavitev tega termina na nov datum/uro, povezan s koledarjem.
            </p>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setSelectedInvoice(null)}
        >
          <div
            className="w-full max-w-md rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">Račun {selectedInvoice.id}</h2>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-2 text-sm text-[var(--ink,#1c2624)]">
              <div>
                <span className="font-semibold">Datum: </span>
                {selectedInvoice.date}
              </div>
              <div>
                <span className="font-semibold">Storitev: </span>
                {selectedInvoice.storitev}
              </div>
              <div>
                <span className="font-semibold">Znesek: </span>
                {selectedInvoice.amount.toFixed(2)} €
              </div>
              <div>
                <span className="font-semibold">Status: </span>
                {selectedInvoice.paid ? 'Plačano' : 'Neplačano'}
              </div>
            </div>
            <p className="mt-4 text-xs italic text-[var(--muted,#6f7c79)]">
              Mockup — tu bo celoten podroben pregled računa.
            </p>
          </div>
        </div>
      )}
      </div>
    </>
  );
}
