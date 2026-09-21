import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { SurfaceMap, EndoStage, PocketDepths, GumMargin, BleedingPoints } from '../types/dental';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// A snapshot of every per-fdi map this hook tracks, at one point in time —
// used only to diff "what's changed since the last save," see
// lastSavedRef/flush() below.
interface Snapshot {
  surfacesByFdi: Record<string, SurfaceMap>;
  postByFdi: Record<string, boolean>;
  endoByFdi: Record<string, EndoStage>;
  pocketsBuccalByFdi: Record<string, PocketDepths>;
  pocketsLingualByFdi: Record<string, PocketDepths>;
  gumMarginByFdi: Record<string, GumMargin>;
  bleedingBuccalByFdi: Record<string, BleedingPoints>;
  bleedingLingualByFdi: Record<string, BleedingPoints>;
  notesByFdi: Record<string, string>;
  bridgeGroupByFdi: Record<string, string>;
}

// Loads the chart's CURRENT state and saves new changes into one visit's
// own tooth_records — see CLAUDE.md's "Visit lifecycle" section: ONE ROW
// PER TOOTH PER VISIT, upserted in place while a visit stays open (never a
// new row per save). `visitId` comes from useOpenVisit.ts's own "resume the
// open visit, or start a new one" resolution — this hook doesn't care where
// it comes from, only that it's a real, already-existing `visits.id`.
// `visitId` is `string | null` specifically because that resolution is
// itself asynchronous: PatientChart.tsx calls this hook before
// useOpenVisit's own id has arrived, so flush() below simply waits (see its
// own guard) until a real id shows up. Only flush() needs `visitId` at all
// — see `patientId`'s own comment on the load effect below for why LOAD no
// longer does.
//
// Now also persists `bridgeGroupByFdi` (which teeth are explicitly linked
// into one bridge — see CLAUDE.md's "Bridge display") via `tooth_records
// .bridge_group_id` (migration 006_add_bridge_group.sql) — the one
// remaining gap this hook used to have; every field PatientChart.tsx
// tracks now round-trips through Supabase.
//
// Every Supabase call lives here, not in PatientChart.tsx directly, per
// CLAUDE.md's own "Coding Conventions" rule.
export function useVisit(patientId: string, visitId: string | null) {
  const [surfacesByFdi, setSurfacesByFdi] = useState<Record<string, SurfaceMap>>({});
  const [postByFdi, setPostByFdi] = useState<Record<string, boolean>>({});
  const [endoByFdi, setEndoByFdi] = useState<Record<string, EndoStage>>({});
  const [pocketsBuccalByFdi, setPocketsBuccalByFdi] = useState<Record<string, PocketDepths>>({});
  const [pocketsLingualByFdi, setPocketsLingualByFdi] = useState<Record<string, PocketDepths>>({});
  const [gumMarginByFdi, setGumMarginByFdi] = useState<Record<string, GumMargin>>({});
  const [bleedingBuccalByFdi, setBleedingBuccalByFdi] = useState<Record<string, BleedingPoints>>({});
  const [bleedingLingualByFdi, setBleedingLingualByFdi] = useState<Record<string, BleedingPoints>>({});
  const [notesByFdi, setNotesByFdi] = useState<Record<string, string>>({});
  const [bridgeGroupByFdi, setBridgeGroupByFdi] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  // Guards flush() from ever running before the initial load has actually
  // finished — without this, a save triggered in the brief window before
  // data arrives would upsert empty/partial state over whatever's already
  // in the database for this visit.
  const [loaded, setLoaded] = useState(false);
  // What flush() last successfully wrote (or, right after load, what was
  // just read) — see flush()'s own comment for how this drives real
  // dirty-tracking instead of rewriting every tooth on every save. A ref,
  // not state: updating it must never itself trigger a re-render or
  // re-run any effect — it's read-and-written only inside flush() and the
  // load effect, both already triggered by other state changes.
  const lastSavedRef = useRef<Snapshot>({
    surfacesByFdi: {},
    postByFdi: {},
    endoByFdi: {},
    pocketsBuccalByFdi: {},
    pocketsLingualByFdi: {},
    gumMarginByFdi: {},
    bleedingBuccalByFdi: {},
    bleedingLingualByFdi: {},
    notesByFdi: {},
    bridgeGroupByFdi: {},
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoaded(false);
    // Scoped by patientId, not visitId — see this function's own comment
    // below for why. patientId is a plain required prop (not async-resolved
    // like visitId), so there's nothing to wait for here.
    async function load() {
      // The live chart's "current state" for a tooth is its row from the
      // patient's MOST RECENT visit that touched it — not necessarily the
      // currently-open visit (see CLAUDE.md's "Visit lifecycle" section).
      // Querying by visit_id alone (the original version of this hook, from
      // before visits actually closed) happened to also show the right
      // "current state" purely because there was only ever ONE visit per
      // patient in practice — closing was unimplemented, so nothing ever
      // started a second one. Now that closeVisit() (PatientChart.tsx) is
      // real, a patient's SECOND visit onward starts with zero rows of its
      // own; loading by that visit_id alone would make every
      // previously-treated tooth appear to silently revert to "healthy" —
      // exactly the regression this rewrite exists to prevent. Fetching
      // every tooth_records row across ALL of this patient's visits and
      // reducing to the latest per tooth_id (below) is the fix — no new
      // migration/view needed, since PostgREST/supabase-js has no
      // `DISTINCT ON`, but a single dentist's per-patient row count is small
      // enough that reducing client-side is completely fine.
      // visits!inner(...) (an INNER join, not a plain embed) is what lets
      // .eq('visits.patient_id', ...) actually filter which rows come back,
      // same reasoning as useToothHistory.ts's own identical pattern.
      const { data, error } = await supabase
        .from('tooth_records')
        .select('*, visits!inner(patient_id, created_at)')
        .eq('visits.patient_id', patientId)
        .order('created_at', { foreignTable: 'visits', ascending: true });
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      const nextSurfaces: Record<string, SurfaceMap> = {};
      const nextPost: Record<string, boolean> = {};
      const nextEndo: Record<string, EndoStage> = {};
      const nextPocketsBuccal: Record<string, PocketDepths> = {};
      const nextPocketsLingual: Record<string, PocketDepths> = {};
      const nextGumMargin: Record<string, GumMargin> = {};
      const nextBleedingBuccal: Record<string, BleedingPoints> = {};
      const nextBleedingLingual: Record<string, BleedingPoints> = {};
      const nextNotes: Record<string, string> = {};
      const nextBridgeGroup: Record<string, string> = {};
      // Ascending visit order means, for any tooth touched in more than one
      // visit, later iterations simply overwrite earlier ones below — so
      // whatever's left once the loop finishes is each tooth's LATEST row,
      // with no extra bookkeeping needed to track "latest so far" by hand.
      for (const row of data ?? []) {
        const fdi = row.tooth_id as string;
        if (row.surfaces && Object.keys(row.surfaces).length > 0) nextSurfaces[fdi] = row.surfaces;
        else delete nextSurfaces[fdi];
        if (row.post) nextPost[fdi] = true;
        else delete nextPost[fdi];
        if (row.endo) nextEndo[fdi] = row.endo;
        else delete nextEndo[fdi];
        if (row.pockets_buccal) nextPocketsBuccal[fdi] = row.pockets_buccal;
        else delete nextPocketsBuccal[fdi];
        if (row.pockets_lingual) nextPocketsLingual[fdi] = row.pockets_lingual;
        else delete nextPocketsLingual[fdi];
        if (row.gum_margin_buccal) nextGumMargin[fdi] = row.gum_margin_buccal;
        else delete nextGumMargin[fdi];
        if (row.bleeding_buccal) nextBleedingBuccal[fdi] = row.bleeding_buccal;
        else delete nextBleedingBuccal[fdi];
        if (row.bleeding_lingual) nextBleedingLingual[fdi] = row.bleeding_lingual;
        else delete nextBleedingLingual[fdi];
        if (row.notes) nextNotes[fdi] = row.notes;
        else delete nextNotes[fdi];
        if (row.bridge_group_id) nextBridgeGroup[fdi] = row.bridge_group_id;
        else delete nextBridgeGroup[fdi];
      }
      setSurfacesByFdi(nextSurfaces);
      setPostByFdi(nextPost);
      setEndoByFdi(nextEndo);
      setPocketsBuccalByFdi(nextPocketsBuccal);
      setPocketsLingualByFdi(nextPocketsLingual);
      setGumMarginByFdi(nextGumMargin);
      setBleedingBuccalByFdi(nextBleedingBuccal);
      setBleedingLingualByFdi(nextBleedingLingual);
      setNotesByFdi(nextNotes);
      setBridgeGroupByFdi(nextBridgeGroup);
      // What was just loaded already matches the database exactly — seed
      // the "last saved" snapshot with it so the first flush afterward
      // only writes teeth actually edited since, not everything that was
      // just read back.
      lastSavedRef.current = {
        surfacesByFdi: nextSurfaces,
        postByFdi: nextPost,
        endoByFdi: nextEndo,
        pocketsBuccalByFdi: nextPocketsBuccal,
        pocketsLingualByFdi: nextPocketsLingual,
        gumMarginByFdi: nextGumMargin,
        bleedingBuccalByFdi: nextBleedingBuccal,
        bleedingLingualByFdi: nextBleedingLingual,
        notesByFdi: nextNotes,
        bridgeGroupByFdi: nextBridgeGroup,
      };
      setLoadError(null);
      setLoading(false);
      setLoaded(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  // Real dirty-tracking: only writes teeth whose data actually differs from
  // `lastSavedRef` (what was last successfully written, or — right after
  // load — what was just read). An earlier version wrote every tooth with
  // ANY data at all, every flush, regardless of whether it had actually
  // changed since the previous save; correct but wasteful once more than a
  // couple of teeth have data.
  //
  // The diff itself is a plain reference check (`!==`) per field per tooth,
  // not a deep-equality comparison — safe here because every setter in
  // PatientChart.tsx already replaces a changed tooth's value with a brand
  // NEW object/array (spreading into a new `{...}`/`[...]`) rather than
  // mutating one in place, the ordinary React immutable-update pattern. An
  // untouched tooth's value is the exact same reference render after
  // render, so `!==` alone correctly separates "actually changed" from
  // "happens to still be around."
  //
  // Wrapped in useCallback, deliberately WITHOUT `saveStatus` itself in the
  // dependency list (it's only ever set here, never read) — PatientChart.tsx
  // lists this function in its own 30s-inactivity-timer effect, and without
  // memoizing, `flush` would get a new identity on every render, including
  // the 'saving' → 'saved' transition this very function causes, which
  // would retrigger that effect and reset/reschedule the timer forever,
  // turning a 30s-after-you-stop-clicking debounce into a runaway
  // save-every-30-seconds loop. Memoized against just the data it actually
  // reads, `flush`'s identity only changes when the data itself does.
  const flush = useCallback(async () => {
    // `loaded` only ever becomes true once the load effect above has run to
    // completion, which itself only happens once `visitId` is non-null (see
    // that effect's own early return) — the `!visitId` half of this guard
    // is therefore never actually reachable in practice, but keeps
    // TypeScript from seeing `visitId` as possibly-null in the upsert rows
    // built below.
    if (!loaded || !visitId) return;
    const allFdis = new Set<string>([
      ...Object.keys(surfacesByFdi),
      ...Object.keys(postByFdi),
      ...Object.keys(endoByFdi),
      ...Object.keys(pocketsBuccalByFdi),
      ...Object.keys(pocketsLingualByFdi),
      ...Object.keys(gumMarginByFdi),
      ...Object.keys(bleedingBuccalByFdi),
      ...Object.keys(bleedingLingualByFdi),
      ...Object.keys(notesByFdi),
      ...Object.keys(bridgeGroupByFdi),
    ]);
    const last = lastSavedRef.current;
    const dirtyFdis = [...allFdis].filter(
      (fdi) =>
        surfacesByFdi[fdi] !== last.surfacesByFdi[fdi] ||
        postByFdi[fdi] !== last.postByFdi[fdi] ||
        endoByFdi[fdi] !== last.endoByFdi[fdi] ||
        pocketsBuccalByFdi[fdi] !== last.pocketsBuccalByFdi[fdi] ||
        pocketsLingualByFdi[fdi] !== last.pocketsLingualByFdi[fdi] ||
        gumMarginByFdi[fdi] !== last.gumMarginByFdi[fdi] ||
        bleedingBuccalByFdi[fdi] !== last.bleedingBuccalByFdi[fdi] ||
        bleedingLingualByFdi[fdi] !== last.bleedingLingualByFdi[fdi] ||
        notesByFdi[fdi] !== last.notesByFdi[fdi] ||
        bridgeGroupByFdi[fdi] !== last.bridgeGroupByFdi[fdi]
    );
    if (dirtyFdis.length === 0) return;
    const rows = dirtyFdis.map((fdi) => ({
      visit_id: visitId,
      tooth_id: fdi,
      surfaces: surfacesByFdi[fdi] ?? {},
      pockets_buccal: pocketsBuccalByFdi[fdi] ?? [null, null, null],
      pockets_lingual: pocketsLingualByFdi[fdi] ?? [null, null, null],
      gum_margin_buccal: gumMarginByFdi[fdi] ?? [null, null, null],
      bleeding_buccal: bleedingBuccalByFdi[fdi] ?? [false, false, false],
      bleeding_lingual: bleedingLingualByFdi[fdi] ?? [false, false, false],
      post: postByFdi[fdi] ?? false,
      endo: endoByFdi[fdi] ?? null,
      notes: notesByFdi[fdi] ?? null,
      bridge_group_id: bridgeGroupByFdi[fdi] ?? null,
    }));
    setSaveStatus('saving');
    const { error } = await supabase.from('tooth_records').upsert(rows, { onConflict: 'visit_id,tooth_id' });
    // Only advance the "last saved" snapshot on success — on failure these
    // fdis are still genuinely unsaved, so the next flush attempt must see
    // them as dirty again and retry them, not silently drop them.
    if (!error) {
      lastSavedRef.current = {
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
      };
    }
    setSaveStatus(error ? 'error' : 'saved');
  }, [
    visitId,
    loaded,
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
  ]);

  // Closes this visit — `closed_at` set once, never un-set — per CLAUDE.md's
  // "Visit lifecycle" design: an explicit "leaving this workspace" action
  // (PatientChart.tsx's handleBackClick/handleSignOutClick, both call
  // flush() first so nothing pending is lost) or a longer safety-net
  // inactivity timeout (PatientChart.tsx's own effect). Once closed,
  // useOpenVisit.ts's own resolution (`.is('closed_at', null)`) will no
  // longer find this visit, so the next time this patient's chart is
  // opened, a fresh visit gets created — which is what actually makes
  // per-tooth history (useToothHistory.ts) start accumulating more than
  // one entry over time. Doesn't itself flush — callers that need pending
  // changes saved first call flush() before this, same as every existing
  // call site already does for other reasons.
  const closeVisit = useCallback(async () => {
    if (!visitId) return;
    await supabase.from('visits').update({ closed_at: new Date().toISOString() }).eq('id', visitId);
  }, [visitId]);

  return {
    surfacesByFdi,
    setSurfacesByFdi,
    postByFdi,
    setPostByFdi,
    endoByFdi,
    setEndoByFdi,
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
    notesByFdi,
    setNotesByFdi,
    bridgeGroupByFdi,
    setBridgeGroupByFdi,
    loading,
    loadError,
    saveStatus,
    flush,
    closeVisit,
  };
}
