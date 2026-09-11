import { useState, type MouseEvent } from 'react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { DentalChart } from '../components/chart/DentalChart';
import { hidesSurfaceDetail } from '../components/chart/ToothTopView';
import { StatusToolbar } from '../components/ui/StatusToolbar';
import { StatusLegend } from '../components/ui/StatusLegend';
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

  return (
    <div className="flex w-full flex-col gap-3 py-4">
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
          preserve 1:2:1. */}
      <div className="grid grid-cols-[1fr_2fr_1fr] items-start gap-3 px-3">
        {/* ---- Left column: identity/contact fields + past appointments ---- */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-4 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">
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
                edit mode swaps the value line for a real input. */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
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
                <span className={VIEW_LABEL_CLASSES}>Št. Interne evidence</span>
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
                the mockup — not a bordered textarea + separate button row. */}
            <div className="flex flex-col gap-1">
              <span className={VIEW_LABEL_CLASSES}>Opombe</span>
              <div className="relative">
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Dodaj opombo o pacientu…"
                  rows={4}
                  className="w-full resize-none rounded-xl border-none bg-[#d2d0ca] px-3 py-2 pb-12 text-[var(--ink,#1c2624)] placeholder:text-[var(--ink,#1c2624)]/50"
                />
                <button
                  type="button"
                  onClick={handleSubmitNote}
                  disabled={!noteDraft.trim()}
                  className="absolute bottom-3 right-3 rounded-full bg-[#1800ad] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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

          <div className="min-h-[220px] flex-1 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">
            <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">Pretekli termini in storitve</h2>
            <p className="mt-2 text-sm italic text-[var(--muted,#6f7c79)]">
              Mockup — tu bo kronološki seznam preteklih obiskov in opravljenih storitev za tega pacienta.
            </p>
          </div>
        </div>

        {/* ---- Middle column: the real, clickable chart + status toolbar + tabs ---- */}
        <div className="flex flex-col gap-3">
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
          />

          <StatusToolbar
            className="w-full"
            selectionCount={selection.length}
            onStatusClick={handleStatusClick}
            onClearSelection={handleClearSelection}
            onTogglePost={handleTogglePost}
            onSetEndoStage={handleSetEndoStage}
            bridgeMessage={bridgeMessage}
          />

          <div className="rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">
            {/* Two tabs, per Gregor's explicit request — "Legenda" (the
                real, already-built component) and "Storitve po zobeh"
                (renamed from the first pass's single combined heading),
                which shows the clicked tooth's chronological history. */}
            <div className="mb-3 flex gap-1 border-b border-[var(--line,#ccd6d4)]">
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

            {activeTab === 'legenda' && <StatusLegend />}

            {activeTab === 'storitve' && (
              <div>
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

        {/* ---- Right column: appointment details + resource links ---- */}
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">
            <h2 className="mb-3 text-lg font-bold text-[var(--ink,#1c2624)]">Podrobnosti termina</h2>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#4CAF50] px-4 py-1.5 text-base font-semibold text-white">Potrjen</span>
              <span className="rounded-full bg-[#4CAF50] px-3 py-1 text-xs font-medium text-white">Računi plačani</span>
            </div>
            <div className="flex flex-col gap-1 text-sm text-[var(--ink,#1c2624)]">
              <span>Datum: 14. 3. 2026</span>
              <span>Ura: 10:30</span>
              <span>Predvidena storitev: Pregled + čiščenje</span>
            </div>
          </div>

          {/* Rentgeni/Fotografije/SMS/E-pošta — modeled on
              design/PatientRecordMockup.svg, which places this frame here
              in the right column below "Podrobnosti termina" (the written
              spec put it in the left column instead; the mockup wins per
              Gregor's "model it the same way" instruction for this page).
              Same active-tab underline pattern as the Legenda/Storitve po
              zobeh tabs in the middle column.
              Fixed height (h-[492px], pixel-matched to the Rentgeni tab's
              own natural height — the tallest of the four) so switching
              tabs never resizes the card, per Gregor's explicit request. */}
          <div className="flex h-[492px] flex-col rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">
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
    </div>
  );
}
