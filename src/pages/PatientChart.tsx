import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { DentalChart } from '../components/chart/DentalChart';
import { hidesSurfaceDetail } from '../components/chart/ToothTopView';
import { samePerioPoint, type PerioPoint } from '../components/chart/perioStyle';
import { UPPER_LEFT, UPPER_RIGHT, LOWER_LEFT, LOWER_RIGHT } from '../data/toothMeta';
import { ToothDetailPanel } from '../components/ui/ToothDetailPanel';
import { StatusToolbar } from '../components/ui/StatusToolbar';
import { useOpenVisit } from '../hooks/useOpenVisit';
import { useVisit } from '../hooks/useVisit';
import type { Surface, ToothStatus, EndoStage, PocketDepths, GumMargin, BleedingPoints } from '../types/dental';

// Every quadrant's own FDI order, left-to-right as displayed — the same
// arrays DentalChart.tsx builds the whole chart from. Used only to walk
// "the next point" during perio entry (advancePerioPoint below); auto-
// advance never crosses a quadrant boundary (see its own comment).
const QUADRANTS: readonly (readonly string[])[] = [UPPER_LEFT, UPPER_RIGHT, LOWER_LEFT, LOWER_RIGHT];

// Each arch's two quadrants combined, left-to-right as displayed — used
// only by handleCreateBridge's own boundary check below. A bridge CAN span
// both quadrants of one arch (crossing the midline, e.g. 44 all the way to
// 31 — a real clinical case, per Monika's explicit correction of an
// earlier same-quadrant-only rule), but never crosses between the upper
// and lower arch, which isn't a bridge at all. Deliberately separate from
// QUADRANTS above, which stays per-quadrant for perio auto-advance — the
// two checks have different boundaries on purpose.
const ARCHES: readonly (readonly string[])[] = [
  [...UPPER_LEFT, ...UPPER_RIGHT],
  [...LOWER_LEFT, ...LOWER_RIGHT],
];

// Statuses whose own mark is drawn from `surfaces.all` directly, never
// resolved per individual surface — see redirectsSurfaceEditToWholeTooth's
// own comment (below, in the component) for the full reasoning. Module-level
// since the list itself never changes across renders.
const WHOLE_TOOTH_MARKER_STATUSES: ToothStatus[] = [
  'abrasion',
  'sealant_planned', 'sealant', 'sealant_existing',
  'overlay_planned', 'overlay', 'overlay_existing',
];

interface PatientChartProps {
  /** Which patient this chart belongs to — from PatientList.tsx's own selection. */
  patientId: string;
  /** Display label for the header ("Priimek Ime") — computed once in PatientList.tsx, not re-fetched here. */
  patientLabel: string;
  /** Back to the patient list — flushes any pending edits first, same as onSignOut below. */
  onBack: () => void;
  onSignOut: () => void;
}

// Real data now, loaded from Supabase — the hand-written SEED_SURFACES/
// SEED_ENDO/SEED_POCKETS_*/SEED_GUM_MARGIN/SEED_BLEEDING_BUCCAL mock
// constants that used to seed this page's local state are gone, and so is
// the single hardcoded TEST_VISIT_ID this page used to load unconditionally
// regardless of which patient was "selected" (there was no selection UI at
// all). `useOpenVisit(patientId)` below resolves which real `visits.id` to
// use (today's still-open visit for this patient, or a freshly created
// one) before `useVisit` loads/saves against it. If that visit has no rows
// yet, the chart simply opens blank, same as any other real (empty) visit
// would — StatusShowcase.tsx keeps its own separate MOCK_* data for
// read-only visual QA, untouched by any of this.

// One chart target — a specific surface, or the whole tooth ('all').
interface Target {
  fdi: string;
  surface: Surface | 'all';
}

function sameTarget(a: Target, b: Target): boolean {
  return a.fdi === b.fdi && a.surface === b.surface;
}

// Page for entering findings on a real chart. Two ways to set a status,
// both wired to the same underlying data so they can never disagree:
//  1. Click a tooth → detail panel opens below → click a surface chip or
//     "Cel zob" → inline picker → pick a status (ToothDetailPanel.tsx,
//     unchanged from before — kept for notes editing and as a guided
//     fallback).
//  2. Click surfaces/whole teeth directly on the chart (Ctrl/Cmd+click to
//     select several at once, Escape to clear), then pick a status in the
//     always-visible StatusToolbar to apply it to the whole selection at
//     once. (An earlier version also had a "pick a status first, lock it,
//     then paint" mode — reverted per explicit feedback that it wasn't good
//     UX: the "armed but not yet applied" state was too easy to miss, so a
//     click on the chart appeared to silently do nothing. Select-then-apply
//     only, going forward.) Applying a status/post/endo-stage/bridge no
//     longer clears the selection afterward, per Monika's explicit
//     request — crown, then post, then endo, all on the same selected
//     tooth(teeth) without reselecting between each one. The selection
//     only ever changes from an actual chart click (replace, or Ctrl/Cmd
//     to extend) or explicitly clearing it (the toolbar's own button, or
//     Escape) — see handleStatusClick's own comment for the fuller history.
// Dental post (zobni zatiček) and endodontic treatment (kanal) are both set
// from the same toolbar, presented as ordinary grid entries exactly like a
// real status — see handleTogglePost/handleSetEndoStage below — even though
// neither is one internally (ToothTopView.tsx's hasPost/endoStage are a
// separate boolean/EndoStage, not part of SurfaceMap, since both need to
// coexist with whatever status a tooth already has: a post commonly
// supports an existing crown, and endo needs to coexist with e.g. a filling
// — the exact gap that motivated pulling endo out of ToothStatus).
// Loads and saves against ONE real Supabase visit, resolved fresh for
// `patientId` on every mount — see useOpenVisit.ts and useVisit.ts's own
// comments for exactly what each does.
export function PatientChart({ patientId, patientLabel, onBack, onSignOut }: PatientChartProps) {
  const { visitId, loading: visitLoading, error: visitError } = useOpenVisit(patientId);
  const [selectedFdi, setSelectedFdi] = useState<string | undefined>();
  const {
    surfacesByFdi,
    setSurfacesByFdi,
    notesByFdi,
    setNotesByFdi,
    // Dental post (zatiček) — a plain per-tooth boolean (ToothData.post),
    // not a status: it can coexist with whatever else is going on for a
    // tooth (commonly a crown or a completed root canal), so it's its own
    // map rather than competing for the surfaces.all slot, same reasoning
    // as sealant used to have before it turned out sealant/implant
    // genuinely can't coexist — post has no such conflict (a post commonly
    // SUPPORTS a crown, it doesn't compete with being one).
    postByFdi,
    setPostByFdi,
    // Endodontic treatment (kanal) — also independent of SurfaceMap, same
    // reasoning as post above: it needs to coexist with whatever status a
    // tooth already has (a filling AND a completed root canal at once),
    // which the old endo/endo_planned/endo_existing statuses couldn't do
    // since they competed with every other status for the single
    // surfaces.all slot. See EndoStage in types/dental.ts.
    endoByFdi,
    setEndoByFdi,
    // Pocket depth (PD) and gum margin/recession (REC), plus bleeding on
    // probing (BOP) — each point (mesial/mid/distal) is entered
    // individually via click-to-focus + type-a-number
    // (see handlePerioPointClick/applyPerioDigit below), not through
    // StatusToolbar; this is a fundamentally different, much higher-volume
    // entry flow (a full exam is ~200 individual numbers) that needed its
    // own interaction design rather than reusing the status-picker
    // pattern. Gum margin is buccal-only, per the app's existing "one
    // gumline" simplification (see PerioGraphRow).
    pocketsBuccalByFdi,
    setPocketsBuccalByFdi,
    pocketsLingualByFdi,
    setPocketsLingualByFdi,
    gumMarginByFdi,
    setGumMarginByFdi,
    bleedingBuccalByFdi,
    setBleedingBuccalByFdi,
    bleedingLingualByFdi,
    setBleedingLingualByFdi,
    // Explicit fdi → bridge-group-id map, set only by handleCreateBridge
    // below — see its own comment, and BridgeRow.tsx's findBridgeGroups,
    // for why a bridge is no longer inferred from adjacent crown/implant/
    // bridge_pontic statuses on its own (that used to silently weld a
    // newly-pontic'd tooth to an unrelated neighboring implant/crown). Now
    // persisted the same way as every other field here — see useVisit.ts's
    // own comment.
    bridgeGroupByFdi,
    setBridgeGroupByFdi,
    loading,
    loadError,
    saveStatus,
    flush,
  } = useVisit(visitId);

  // Which single probing point is currently focused for keyboard entry, if
  // any — see PerioPoint (perioStyle.ts). Mutually exclusive with `selection`
  // below (entering numbers and painting statuses are two separate modes;
  // starting one clears the other, see handlePerioPointClick/handleTargetClick).
  const [focusedPerioPoint, setFocusedPerioPoint] = useState<PerioPoint | null>(null);

  const [selection, setSelection] = useState<Target[]>([]);
  // Why the last "Člen mostu" click didn't create a bridge, if it didn't —
  // handleCreateBridge below used to fail these checks completely
  // silently (matching handleTogglePost/handleSetEndoStage's own
  // harmless-no-op-on-empty-selection convention), but a bridge attempt
  // failing for a REASON — no anchor in the selection, or only one tooth
  // actually got selected because the second click wasn't a Ctrl/Cmd+click
  // and silently replaced the first — needs to say so, or it just reads as
  // "nothing happened, is this broken?" per Monika's own report. Cleared on
  // the next chart click/selection change (handleTargetClick) and on a
  // successful bridge creation, so a stale message never lingers. Rendered
  // by `StatusToolbar` itself (right above the status grid, next to the
  // "Člen mostu" button that triggered it) rather than up in the page
  // header — a first version put it there, which Monika still read as
  // "nothing happens," since it sits far from where you're actually
  // looking right after clicking the toolbar.
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);

  // Statuses that need to land on the whole tooth (`surfaces.all`) no
  // matter which individual surface was actually clicked to apply them.
  // Two different reasons put a status here:
  //  - hidesSurfaceDetail()'s own set (crown, implant, missing, extracted,
  //    prosthesis_crown, bridge_pontic, prosthesis, impacted) — these skip
  //    per-surface rendering ENTIRELY (ToothTopView.tsx's skipSubdivision),
  //    so a per-surface apply either paints nothing visible or — worse —
  //    just that one triangle in the status's flat color, "half a crown."
  //  - WHOLE_TOOTH_MARKER_STATUSES below — `abrasion`, and (per Monika's
  //    explicit follow-up, same report extended to these two once she saw
  //    the parallel) the sealant and overlay triples. All seven share the
  //    same underlying bug: their own mark is drawn from `surfaces.all`
  //    directly — abrasion via `wholeToothStatus` (anterior) or the
  //    resolved OCCLUSAL surface specifically (posterior) in
  //    ToothTopView.tsx/ToothSideView.tsx; sealant's tilde and overlay's
  //    "[" cap via `statuses[fdi]` in BridgeRow.tsx, which ArchRow.tsx
  //    only ever populates from `surfaces.all` (never a per-surface
  //    override) — never any OTHER individual surface, so clicking e.g. a
  //    mesial/distal/buccal/lingual zone and picking one of these had no
  //    visible effect at all. Unlike hidesSurfaceDetail()'s own group,
  //    none of these seven hide the tooth's other per-surface detail — the
  //    triangles/occlusal rectangle still render (abrasion just leaves
  //    them unfilled; sealant/overlay don't touch them at all, per their
  //    own `fill: 'none'`/no-symbol STATUS_STYLES entries), and a
  //    DIFFERENT surface set independently afterward — caries on one
  //    specific zone, say — still shows normally. That's why they're
  //    handled here rather than folded into hidesSurfaceDetail() itself,
  //    which ToothDetailPanel.tsx also reads for a "per-surface changes
  //    won't be visible" warning that would be wrong for all seven —
  //    other surfaces' own changes DO stay visible.
  function redirectsSurfaceEditToWholeTooth(status: ToothStatus): boolean {
    return WHOLE_TOOTH_MARKER_STATUSES.includes(status) || hidesSurfaceDetail(status);
  }

  // Merges — touches only the one surface, leaving `all` and every other
  // surface untouched, UNLESS redirectsSurfaceEditToWholeTooth() says this
  // particular status needs the whole tooth instead (see its own comment
  // above) — regardless of which specific surface was clicked/selected.
  // Single choke point: both the direct-click-selection flow
  // (applyStatusToTarget, below) and ToothDetailPanel.tsx's own per-surface
  // chip flow call this same function, so both are fixed by the one check.
  function handleSurfaceStatusChange(fdi: string, surface: Surface, status: ToothStatus) {
    if (redirectsSurfaceEditToWholeTooth(status)) {
      handleWholeToothStatusChange(fdi, status);
      return;
    }
    setSurfacesByFdi((prev) => ({ ...prev, [fdi]: { ...prev[fdi], [surface]: status } }));
  }

  // Replaces — clears any per-surface overrides so the chart can't show a
  // stale surface finding contradicting the status just picked for the
  // whole tooth.
  function handleWholeToothStatusChange(fdi: string, status: ToothStatus) {
    setSurfacesByFdi((prev) => ({ ...prev, [fdi]: { all: status } }));
  }

  function applyStatusToTarget(target: Target, status: ToothStatus) {
    if (target.surface === 'all') handleWholeToothStatusChange(target.fdi, status);
    else handleSurfaceStatusChange(target.fdi, target.surface, status);
  }

  function isTargetSelected(fdi: string, surface: Surface | 'all'): boolean {
    return selection.some((t) => sameTarget(t, { fdi, surface }));
  }

  // Coarser than isTargetSelected above: true if ANY target belonging to
  // this tooth is selected, regardless of which specific surface — drives
  // the tloris square's own outline (TlorisRow.tsx) and the FDI number's
  // highlight (NumberRow.tsx) so both always agree on "which tooth are we
  // currently working on," not just the fine-grained per-zone overlay.
  // Previously the tloris square's outline was driven by a separate,
  // older `selectedFdi` (only ever updated by clicking inside the square
  // itself, not the number below it), so clicking the number could select
  // a new tooth for the toolbar while the *previous* tooth's square stayed
  // outlined — exactly this desync, fixed by having both read the same
  // `selection` state instead of two independent ones.
  function isFdiSelected(fdi: string): boolean {
    return selection.some((t) => t.fdi === fdi);
  }

  // Fired by every surface zone, occlusal rectangle, whole-tooth
  // square/circle, and FDI-number click across the whole chart (threaded
  // through DentalChart → ArchRow → TlorisRow/NumberRow → ToothTopView).
  // Plain click replaces the selection with just this target; Ctrl/Cmd (or
  // Shift) + click toggles it in/out of the existing selection.
  function handleTargetClick(fdi: string, surface: Surface | 'all', e: MouseEvent) {
    const target: Target = { fdi, surface };
    const extend = e.ctrlKey || e.metaKey || e.shiftKey;
    setSelection((prev) => {
      const idx = prev.findIndex((t) => sameTarget(t, target));
      if (extend) {
        return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, target];
      }
      return [target];
    });
    // Applying a status and entering a perio number are two separate
    // interaction modes — starting one exits the other cleanly, same
    // reasoning as handlePerioPointClick clearing `selection` below.
    setFocusedPerioPoint(null);
    // A fresh chart click starts a new attempt — any leftover explanation
    // from a previous failed "Člen mostu" click no longer applies to it.
    setBridgeMessage(null);
  }

  // Fired by clicking a status in StatusToolbar — only meaningful with an
  // active selection (the toolbar disables the grid otherwise). `bridge_pontic`
  // is special-cased to handleCreateBridge below rather than falling through
  // to the generic apply-to-every-selected-target path every other status
  // uses: that generic path would silently overwrite an anchor tooth's own
  // crown/implant status to bridge_pontic if it happened to be part of the
  // selection, and leave BridgeRow to guess bracket placement from whatever
  // statuses ended up adjacent afterward — see BridgeRow.tsx's own history
  // comment for the bugs that produced.
  //
  // Deliberately does NOT clear `selection` afterward — per Monika's
  // explicit request: apply crown to tooth 21, then (still selected, no
  // reselecting) toggle the dental post on it too, all without re-clicking
  // the tooth in between. The selection now only ever changes from an
  // actual chart click (handleTargetClick, which replaces or Ctrl/Cmd-
  // extends it) or the explicit "Prekliči izbiro" button/Escape
  // (handleClearSelection) — never as a side effect of applying a service.
  // This used to clear the selection on every apply, matching
  // handleTogglePost/handleSetEndoStage's own (also since-removed)
  // clearing below, on the reasoning that "uniform treatment end to end"
  // meant clearing everywhere — reversed once it turned out that uniformity
  // was exactly what made applying several services to the same tooth
  // tedious (reselect after every single one).
  function handleStatusClick(status: ToothStatus) {
    if (selection.length === 0) return;
    if (status === 'bridge_pontic') {
      handleCreateBridge();
      return;
    }
    selection.forEach((target) => applyStatusToTarget(target, status));
  }

  // Forming a bridge is a deliberate act, not something inferred after the
  // fact: select an existing anchor tooth (already `crown` or `implant`)
  // together with the teeth it should support, then click "Člen mostu" —
  // per Monika's explicit request, replacing the earlier purely
  // status-driven bracket detection in BridgeRow.tsx (see its own history
  // comment). "The implant/crown needs to exist first" — clicking "Člen
  // mostu" on a selection that doesn't satisfy that (or any of the other
  // checks below) creates no bridge, but unlike every other toolbar action's
  // own silent no-op on an empty selection (handleTogglePost/
  // handleSetEndoStage), each failure here sets a specific `bridgeMessage`
  // explaining why — Monika hit exactly this with no feedback at all
  // ("nothing happens") when a plain second click had silently replaced
  // the first tooth's selection instead of adding to it, the single most
  // likely way to land here with fewer teeth selected than intended.
  function handleCreateBridge() {
    const fdis = [...new Set(selection.map((t) => t.fdi))];
    // Same as handleStatusClick above: the selection stays untouched, on
    // success or failure alike, so the just-anchored teeth are still
    // selected afterward for whatever service comes next (a post on the
    // anchor, say) — see handleStatusClick's own comment for the fuller
    // reasoning.
    if (fdis.length < 2) {
      // The single most common way to land here: clicking a second tooth
      // without holding Ctrl/Cmd (or Shift) doesn't ADD it to the
      // selection, it REPLACES the first tooth's selection with just the
      // second one — so "I selected 21 and 22 together" can easily mean
      // the selection actually only ever held one of them by the time
      // this fired. Spelled out explicitly rather than left as a silent
      // no-op, since this exact confusion is what prompted this message
      // to exist at all.
      setBridgeMessage(
        'Za most izberite vsaj dva zoba skupaj — pridržite Ctrl (ali Cmd na Macu) med klikom na drugi zob, da ostane izbran tudi prvi.'
      );
      return;
    }
    // A bridge CAN cross the midline into the arch's other quadrant (e.g.
    // 44 all the way to 31 — per Monika's explicit correction; see
    // ARCHES above and BridgeRow.tsx's own crossesToPrev/crossesToNext),
    // but never between the upper and lower arch — that isn't a bridge.
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
      // "The implant/crown needs to exist first" — nothing to attach a
      // bridge to without one already in the selection.
      setBridgeMessage('Izbira mora vsebovati zob, ki že ima prevleko ali implantat — most se pripne nanj.');
      return;
    }
    // A bridge with two anchors must be anchored on the SAME type at both
    // ends — both crown, or both implant, never one of each — per Monika's
    // explicit clinical correction ("fixing bridge on crown on one side and
    // implant on the other is a professional mistake"). Only meaningful
    // once there are 2+ anchors in the selection; a single-anchor
    // (cantilever) bridge has nothing to mismatch against.
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
    // Anchor teeth keep whatever status they already have (crown/implant,
    // untouched) — only the other, newly-selected teeth become the
    // bridge's pontics.
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

  function handleClearSelection() {
    setSelection([]);
    setBridgeMessage(null);
  }

  // Dental post (zobni zatiček) is presented as one entry in StatusToolbar,
  // same as a real status — per Monika's explicit request, not a separate
  // add/remove pair. One click toggles it for every distinct TOOTH
  // represented in the current selection (regardless of which specific
  // surface(s) were clicked to select it — post is a whole-tooth
  // attribute): on if any of them currently lack it, off only once all of
  // them already have it. Leaves the selection untouched afterward, same as
  // handleStatusClick above — per Monika's explicit request, so e.g.
  // applying crown to tooth 21 and then toggling its post doesn't require
  // reselecting 21 in between.
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

  // Endodontic treatment (kanal) — same uniform-grid-entry, whole-tooth
  // treatment as handleTogglePost above, generalized from a boolean to a
  // tri-state EndoStage: sets `stage` for every distinct tooth in the
  // current selection if any of them don't already have exactly that
  // stage, clears it for all of them if they already do (so clicking the
  // same stage again on an already-matching selection toggles it off,
  // mirroring post's own on/off behavior). Independent of surfacesByFdi —
  // this is exactly what lets endo coexist with a filling/crown/caries/etc.
  // on the same tooth, the whole point of pulling it out of ToothStatus.
  // Leaves the selection untouched afterward, same as handleTogglePost.
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

  // Finds the quadrant array a given fdi belongs to — used only to walk
  // "the next point" during perio entry.
  function quadrantOf(fdi: string): readonly string[] | undefined {
    return QUADRANTS.find((q) => q.includes(fdi));
  }

  // Where focus goes after typing a digit — mesial → mid → distal, then the
  // next tooth's mesial point, walking the SAME quadrant + surface/kind the
  // current point belongs to. Deliberately stops at the end of a quadrant's
  // row (returns null) rather than crossing into a sibling row (PD buccal →
  // PD lingual, or across arches) — keeps this logic in one place without
  // new cross-component wiring; a fresh click starts the next row.
  function advancePerioPoint(point: PerioPoint): PerioPoint | null {
    if (point.index < 2) return { ...point, index: (point.index + 1) as 0 | 1 | 2 };
    const quadrant = quadrantOf(point.fdi);
    const nextFdi = quadrant?.[quadrant.indexOf(point.fdi) + 1];
    if (!nextFdi) return null;
    return point.kind === 'pocket' ? { kind: 'pocket', fdi: nextFdi, surface: point.surface, index: 0 } : { kind: 'gum', fdi: nextFdi, index: 0 };
  }

  // Bleeding on probing (BOP) — flips the flag at one specific pocket-depth
  // point in place, independent of its depth value. Fired both by clicking
  // an already-focused point again (see handlePerioPointClick) and by
  // Shift+digit while typing (see applyPerioDigit) — both call this exact
  // same function, so the two mechanisms can never disagree. Wrapped in
  // useCallback (as are toggleGumSign/applyPerioDigit below) purely so the
  // keydown effect further down can list applyPerioDigit in its own
  // dependency array without that effect re-subscribing on every render —
  // the underlying logic is unchanged.
  const toggleBleeding = useCallback(
    (point: Extract<PerioPoint, { kind: 'pocket' }>) => {
      const setter = point.surface === 'buccal' ? setBleedingBuccalByFdi : setBleedingLingualByFdi;
      setter((prev) => {
        const cur = prev[point.fdi] ?? [false, false, false];
        const next = [...cur] as BleedingPoints;
        next[point.index] = !next[point.index];
        return { ...prev, [point.fdi]: next };
      });
    },
    [setBleedingBuccalByFdi, setBleedingLingualByFdi]
  );

  // Recession-vs-overgrowth sign — the gum-margin equivalent of
  // toggleBleeding above, flipping the sign of whatever value is already at
  // that point in place. A no-op on a point with no value yet (nothing to
  // flip the sign of before a digit's been typed there at all).
  const toggleGumSign = useCallback(
    (point: Extract<PerioPoint, { kind: 'gum' }>) => {
      setGumMarginByFdi((prev) => {
        const cur = prev[point.fdi];
        if (cur == null || cur[point.index] == null) return prev;
        const next = [...cur] as GumMargin;
        next[point.index] = -(next[point.index] as number);
        return { ...prev, [point.fdi]: next };
      });
    },
    [setGumMarginByFdi]
  );

  // Click on a chart probing point — same target clicked twice in a row
  // (still focused from the first click) toggles its secondary flag (BOP
  // for a pocket-depth point, sign for a gum-margin point) in place, since
  // there's no room at this scale for a separate always-visible toggle
  // control next to every point (see CLAUDE.md's own BOP-as-ring-color
  // reasoning). A different (or not-yet-focused) point just focuses it,
  // ready for a digit to be typed. Also clears any active status
  // `selection` — entering numbers and painting statuses are two separate
  // modes, so starting one exits the other (mirrored by handleTargetClick
  // clearing `focusedPerioPoint` on its own side).
  function handlePerioPointClick(point: PerioPoint) {
    setSelection([]);
    if (samePerioPoint(focusedPerioPoint, point)) {
      if (point.kind === 'pocket') toggleBleeding(point);
      else toggleGumSign(point);
      return;
    }
    setFocusedPerioPoint(point);
  }

  // Sets one digit at the focused point, then advances focus — the actual
  // keystroke handler (below) calls this. Single digit only for now: real
  // probing depths are almost always single-digit, and the visible circle
  // only has room for one character anyway; a two-digit UI is future work,
  // not a data-model change (PocketDepths/GumMargin already hold plain
  // numbers). Holding Shift toggles the same secondary flag
  // toggleBleeding/toggleGumSign do, as a one-keystroke shortcut — a plain
  // digit never touches that flag, so correcting a depth later never
  // silently un-marks a point that was already flagged.
  const applyPerioDigit = useCallback(
    (point: PerioPoint, digit: number, shiftHeld: boolean) => {
      if (point.kind === 'pocket') {
        const setter = point.surface === 'buccal' ? setPocketsBuccalByFdi : setPocketsLingualByFdi;
        setter((prev) => {
          const cur = prev[point.fdi] ?? [null, null, null];
          const next = [...cur] as PocketDepths;
          next[point.index] = digit;
          return { ...prev, [point.fdi]: next };
        });
        if (shiftHeld) toggleBleeding(point);
      } else {
        setGumMarginByFdi((prev) => {
          const cur = prev[point.fdi] ?? [null, null, null];
          const priorValue = cur[point.index];
          // Preserve whatever sign this point already had; a brand-new point
          // defaults to negative (recession — the common clinical case, and
          // what the REC label already assumes when it shows a plain
          // magnitude with no sign).
          const priorSign = priorValue != null && priorValue > 0 ? 1 : -1;
          const next = [...cur] as GumMargin;
          next[point.index] = priorSign * digit;
          return { ...prev, [point.fdi]: next };
        });
        if (shiftHeld) toggleGumSign(point);
      }
    },
    [setPocketsBuccalByFdi, setPocketsLingualByFdi, toggleBleeding, setGumMarginByFdi, toggleGumSign]
  );

  // Escape clears the selection (and any focused perio point) — guarded so
  // pressing it inside the notes textarea (or any other input) doesn't also
  // clear a chart selection the user isn't even looking at. A focused perio
  // point additionally intercepts plain digit keys (0–9) to fill that point
  // and auto-advance — same text-input guard applies, so typing a patient's
  // notes never gets mistaken for perio entry.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'Escape') {
        setSelection([]);
        setFocusedPerioPoint(null);
        setBridgeMessage(null);
        return;
      }
      if (focusedPerioPoint && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        applyPerioDigit(focusedPerioPoint, Number(e.key), e.shiftKey);
        setFocusedPerioPoint(advancePerioPoint(focusedPerioPoint));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // applyPerioDigit is a plain function redefined every render, but it
    // only ever closes over React's own setState setters (stable across
    // renders) plus its own arguments — nothing it reads can go stale — so
    // listing it here just re-attaches this listener on every render
    // rather than fixing a real bug; still the correct, lint-satisfying
    // fix (its own suggested one) over leaving it out.
  }, [focusedPerioPoint, applyPerioDigit]);

  // Autosave: flush to Supabase ~30s after the LAST change, not 30s after
  // the first — per Monika's explicit request that saving happen once
  // things settle down, not fragment one sitting into many saves, and that
  // clicking the wrong service leaves a window to fix it before anything
  // commits. Every relevant state map in the dependency array resets this
  // effect's own timer on any change, restarting the wait — the effect's
  // cleanup (returned below) is what cancels the PREVIOUS timer each time,
  // the standard React debounce-via-effect pattern. See useVisit.ts's own
  // flush() for exactly what gets written — real dirty-tracking now, only
  // the teeth that actually changed since the last save, not every tooth
  // with any data at all.
  useEffect(() => {
    const timer = setTimeout(() => {
      flush();
    }, 30000);
    return () => clearTimeout(timer);
  }, [
    surfacesByFdi,
    postByFdi,
    endoByFdi,
    pocketsBuccalByFdi,
    pocketsLingualByFdi,
    gumMarginByFdi,
    bleedingBuccalByFdi,
    bleedingLingualByFdi,
    notesByFdi,
    bridgeGroupByFdi,
    flush,
  ]);

  // The other save triggers, alongside the 30s timer above: leaving the
  // workspace entirely, either back to the patient list or all the way out
  // via sign-out. Both flush immediately — don't wait for the timer — so
  // switching patients (or signing out) never leaves the last few seconds
  // of work stranded only in memory.
  async function handleBackClick() {
    await flush();
    onBack();
  }
  async function handleSignOutClick() {
    await flush();
    onSignOut();
  }

  if (visitLoading || loading) {
    return <p className="p-6 text-sm text-[var(--ink-soft,#45524f)]">Nalaganje…</p>;
  }
  if (visitError) {
    return <p className="p-6 text-sm text-[var(--danger,#b3261e)]">Napaka pri odpiranju obiska: {visitError}</p>;
  }
  if (loadError) {
    return <p className="p-6 text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {loadError}</p>;
  }

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={handleBackClick}
            className="mb-1.5 text-sm text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
          >
            ← Nazaj na seznam pacientov
          </button>
          <h1 className="text-2xl font-semibold text-[var(--ink,#1c2624)]">Zobna karta — {patientLabel}</h1>
          <p className="mt-1.5 text-sm text-[var(--ink-soft,#45524f)]">
            Kliknite na zob za izbiro. {selectedFdi ? `Izbran zob: ${selectedFdi}` : 'Noben zob ni izbran.'}
          </p>
          <p className="mt-1 text-xs text-[var(--muted,#6f7c79)]">
            {focusedPerioPoint
              ? 'Vnos globine žepka / umika dlesni — vtipkajte številko (0–9). Shift+številka = krvavitev / obrat predznaka. Kliknite točko znova za preklop brez tipkanja.'
              : 'Za vnos globine žepka ali umika dlesni kliknite eno od točk ob zobeh.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Autosave status — see the 30s-flush effect above for when
              this actually fires. No manual "Save" button anywhere on this
              page by design (CLAUDE.md's "Visit lifecycle"). */}
          <span className="text-xs text-[var(--muted,#6f7c79)]">
            {saveStatus === 'saving' && 'Shranjujem …'}
            {saveStatus === 'saved' && 'Shranjeno'}
            {saveStatus === 'error' && <span className="text-[var(--danger,#b3261e)]">Napaka pri shranjevanju</span>}
          </span>
          <button
            type="button"
            onClick={handleSignOutClick}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm text-[var(--ink-soft,#45524f)]"
          >
            Odjava
          </button>
        </div>
      </div>
      <div className="flex items-start gap-4">
        <DentalChart
          surfacesByFdi={surfacesByFdi}
          postByFdi={postByFdi}
          endoByFdi={endoByFdi}
          bridgeGroupByFdi={bridgeGroupByFdi}
          pocketsBuccal={pocketsBuccalByFdi}
          pocketsLingual={pocketsLingualByFdi}
          gumMargin={gumMarginByFdi}
          bleedingBuccal={bleedingBuccalByFdi}
          bleedingLingual={bleedingLingualByFdi}
          onSelect={setSelectedFdi}
          onTargetClick={handleTargetClick}
          isTargetSelected={isTargetSelected}
          isFdiSelected={isFdiSelected}
          onPerioPointClick={handlePerioPointClick}
          focusedPerioPoint={focusedPerioPoint}
        />
        <StatusToolbar
          selectionCount={selection.length}
          onStatusClick={handleStatusClick}
          onClearSelection={handleClearSelection}
          onTogglePost={handleTogglePost}
          onSetEndoStage={handleSetEndoStage}
          bridgeMessage={bridgeMessage}
        />
      </div>
      {selectedFdi && (
        // key={selectedFdi}: remounts the panel fresh on every tooth switch
        // so its internal open-picker state never bleeds from one tooth to
        // the next.
        <ToothDetailPanel
          key={selectedFdi}
          fdi={selectedFdi}
          surfaces={surfacesByFdi[selectedFdi]}
          notes={notesByFdi[selectedFdi]}
          onSurfaceStatusChange={(surface, status) => handleSurfaceStatusChange(selectedFdi, surface, status)}
          onWholeToothStatusChange={(status) => handleWholeToothStatusChange(selectedFdi, status)}
          onNotesChange={(text) => setNotesByFdi((prev) => ({ ...prev, [selectedFdi]: text }))}
        />
      )}
    </div>
  );
}
