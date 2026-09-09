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

// Loads and saves one visit's tooth_records — see CLAUDE.md's "Visit
// lifecycle" section: ONE ROW PER TOOTH PER VISIT, upserted in place while
// a visit stays open (never a new row per save). `visitId` now comes from
// useOpenVisit.ts's own "resume today's open visit, or start a new one"
// resolution (driven by a real patient picked in PatientList.tsx) rather
// than a hardcoded test constant — this hook still doesn't care where it
// comes from, only that it's a real, already-existing `visits.id`.
// `visitId` is `string | null` specifically because that resolution is
// itself asynchronous: PatientChart.tsx calls this hook before
// useOpenVisit's own id has arrived, so the load effect below simply waits
// (stays in its initial loading state) until a real id shows up.
//
// Deliberately does NOT yet implement CLOSING a visit — nothing here ever
// sets `visits.closed_at`; that's the other half of the lifecycle
// useOpenVisit.ts's own comment also flags as still a future step.
//
// Now also persists `bridgeGroupByFdi` (which teeth are explicitly linked
// into one bridge — see CLAUDE.md's "Bridge display") via `tooth_records
// .bridge_group_id` (migration 006_add_bridge_group.sql) — the one
// remaining gap this hook used to have; every field PatientChart.tsx
// tracks now round-trips through Supabase.
//
// Every Supabase call lives here, not in PatientChart.tsx directly, per
// CLAUDE.md's own "Coding Conventions" rule.
export function useVisit(visitId: string | null) {
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
    // No visit resolved yet (useOpenVisit.ts is still working out which
    // visits.id to use) — stay in the loading state rather than querying
    // with a null visit_id, which would either error or (worse) silently
    // match nothing and look like an empty, freshly-loaded visit.
    if (!visitId) return;
    async function load() {
      const { data, error } = await supabase.from('tooth_records').select('*').eq('visit_id', visitId);
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
      for (const row of data ?? []) {
        const fdi = row.tooth_id as string;
        if (row.surfaces && Object.keys(row.surfaces).length > 0) nextSurfaces[fdi] = row.surfaces;
        if (row.post) nextPost[fdi] = true;
        if (row.endo) nextEndo[fdi] = row.endo;
        if (row.pockets_buccal) nextPocketsBuccal[fdi] = row.pockets_buccal;
        if (row.pockets_lingual) nextPocketsLingual[fdi] = row.pockets_lingual;
        if (row.gum_margin_buccal) nextGumMargin[fdi] = row.gum_margin_buccal;
        if (row.bleeding_buccal) nextBleedingBuccal[fdi] = row.bleeding_buccal;
        if (row.bleeding_lingual) nextBleedingLingual[fdi] = row.bleeding_lingual;
        if (row.notes) nextNotes[fdi] = row.notes;
        if (row.bridge_group_id) nextBridgeGroup[fdi] = row.bridge_group_id;
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
  }, [visitId]);

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
  };
}
