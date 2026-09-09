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

const FIELD_INPUT_CLASSES = 'rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]';
const FIELD_LABEL_CLASSES = 'flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]';

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
    <div className="mx-auto flex max-w-[1900px] flex-col gap-3 p-4">
      {/* Row 1: back button + health-questionnaire alert banner — entirely
          illustrative, see the file-level comment above. */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="flex-none text-sm text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
        >
          ← Nazaj na seznam pacientov
        </button>
        <div className="flex-1 rounded-md bg-[#e0231c] px-4 py-2 text-sm font-bold text-white">
          Zdravstvene podrobnosti pacienta iz vprašalnika o zdravju (alergije, razna akutna stanja)
        </div>
      </div>

      <div className="grid grid-cols-[300px_1fr_380px] items-start gap-4">
        {/* ---- Left column: identity/contact fields + past appointments ---- */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">
            <h1 className="text-3xl font-bold text-[var(--ink,#1c2624)]">Goslar Gregor</h1>

            <div className="flex gap-3">
              <label className={FIELD_LABEL_CLASSES + ' flex-1'}>
                Datum rojstva
                <input type="date" defaultValue="1985-06-12" className={FIELD_INPUT_CLASSES} />
              </label>
              <label className={FIELD_LABEL_CLASSES + ' flex-1'}>
                Spol
                <select defaultValue="M" className={FIELD_INPUT_CLASSES}>
                  <option value="">Neznano</option>
                  <option value="F">Ženski</option>
                  <option value="M">Moški</option>
                </select>
              </label>
            </div>

            <div className="flex gap-3">
              <label className={FIELD_LABEL_CLASSES + ' flex-1'}>
                Telefon
                <PhoneInput defaultCountry="SI" value={phone} onChange={(v) => setPhone(v ?? '')} />
              </label>
              <label className={FIELD_LABEL_CLASSES + ' flex-1'}>
                E-pošta
                <input type="email" defaultValue="gregor.goslar@example.com" className={FIELD_INPUT_CLASSES} />
              </label>
            </div>

            <label className={FIELD_LABEL_CLASSES}>
              Naslov
              <input defaultValue="Slovenska cesta 15" className={FIELD_INPUT_CLASSES} />
            </label>

            <div className="flex gap-3">
              <div className="flex flex-1 gap-3">
                <label className={FIELD_LABEL_CLASSES + ' flex-1'}>
                  Poštna št.
                  <input inputMode="numeric" defaultValue="1000" className={FIELD_INPUT_CLASSES} />
                </label>
                <label className={FIELD_LABEL_CLASSES + ' flex-1'}>
                  Kraj
                  <input defaultValue="Ljubljana" className={FIELD_INPUT_CLASSES} />
                </label>
              </div>
              <label className={FIELD_LABEL_CLASSES + ' flex-1'}>
                Št. zdravstvene kartice
                <input inputMode="numeric" maxLength={9} defaultValue="123456789" className={FIELD_INPUT_CLASSES} />
              </label>
            </div>
          </div>

          <div className="min-h-[280px] flex-1 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">
            <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">Pretekli termini in storitve</h2>
            <p className="mt-2 text-sm italic text-[var(--muted,#6f7c79)]">
              Mockup — tu bo kronološki seznam preteklih obiskov in opravljenih storitev za tega pacienta.
            </p>
          </div>
        </div>

        {/* ---- Middle column: the real, clickable chart + status toolbar + tabs ---- */}
        <div className="flex flex-col gap-3">
          <p className="text-xs text-[var(--muted,#6f7c79)]">
            Kliknite na zob za izbiro in urejanje statusa/storitev spodaj.
          </p>

          <DentalChart
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

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">
            <button type="button" className="text-sm font-medium text-[var(--ink,#1c2624)] hover:text-[var(--accent,#2e6e62)]">
              Rentgeni
            </button>
            <button type="button" className="text-sm font-medium text-[var(--ink,#1c2624)] hover:text-[var(--accent,#2e6e62)]">
              Fotografije
            </button>
            <button type="button" className="text-sm font-medium text-[var(--ink,#1c2624)] hover:text-[var(--accent,#2e6e62)]">
              SMS
            </button>
            <button type="button" className="text-sm font-medium text-[var(--ink,#1c2624)] hover:text-[var(--accent,#2e6e62)]">
              E-pošta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
