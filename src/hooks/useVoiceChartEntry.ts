import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { BleedingPoints, EndoStage, GumMargin, PocketDepths, SurfaceMap, ToothStatus } from '../types/dental';
import { bridgeRange, parseVoiceCommand, type VoiceCommand, type VoiceContext } from '../lib/voice/parseVoiceCommand';
import { useSpeechRecognition } from './useSpeechRecognition';

// Recognition is the browser's own (Chrome/Edge). A cloud engine (OpenAI
// gpt-4o-transcribe) was tried on 2026-10-20/21 and removed at Gregor's
// request: it invented whole dental sentences from noise and changed teeth
// nobody had mentioned. Don't bring a cloud engine back without asking.

// Voice entry on the patient chart: recognised phrases → parseVoiceCommand →
// applied straight to the chart's own state (the same maps clicks and typing
// change, so autosave and history work as usual). Every phrase is applied at
// once and can be undone ("razveljavi" or the button): before applying, the
// touched teeth's values are remembered and put back on undo.

type Setter<T> = Dispatch<SetStateAction<Record<string, T>>>;

export interface ChartMaps {
  surfacesByFdi: Record<string, SurfaceMap>;
  notesByFdi: Record<string, string>;
  postByFdi: Record<string, boolean>;
  endoByFdi: Record<string, EndoStage>;
  pocketsBuccalByFdi: Record<string, PocketDepths>;
  pocketsLingualByFdi: Record<string, PocketDepths>;
  gumMarginByFdi: Record<string, GumMargin>;
  bleedingBuccalByFdi: Record<string, BleedingPoints>;
  bleedingLingualByFdi: Record<string, BleedingPoints>;
  bridgeGroupByFdi: Record<string, string>;
}

export interface ChartSetters {
  setSurfacesByFdi: Setter<SurfaceMap>;
  setNotesByFdi: Setter<string>;
  setPostByFdi: Setter<boolean>;
  setEndoByFdi: Setter<EndoStage>;
  setPocketsBuccalByFdi: Setter<PocketDepths>;
  setPocketsLingualByFdi: Setter<PocketDepths>;
  setGumMarginByFdi: Setter<GumMargin>;
  setBleedingBuccalByFdi: Setter<BleedingPoints>;
  setBleedingLingualByFdi: Setter<BleedingPoints>;
  setBridgeGroupByFdi: Setter<string>;
}

export interface VoiceLogEntry {
  id: number;
  heard: string;
  applied: string[];
  unknown: string[];
  /** Single misheard words — the panel lets staff teach what they mean. */
  unknownWords: string[];
  undone: boolean;
}

/** One tooth's values before a phrase changed it. */
type ToothSnapshot = { fdi: string } & { [K in keyof ChartMaps]: ChartMaps[K][string] | undefined };

const MAP_KEYS: (keyof ChartMaps)[] = [
  'surfacesByFdi',
  'notesByFdi',
  'postByFdi',
  'endoByFdi',
  'pocketsBuccalByFdi',
  'pocketsLingualByFdi',
  'gumMarginByFdi',
  'bleedingBuccalByFdi',
  'bleedingLingualByFdi',
  'bridgeGroupByFdi',
];

const FINDING_WINDOW_MS = 10_000;

// Teeth the perio sequence passes over.
const NOT_PROBED: ToothStatus[] = ['missing', 'extracted', 'impacted', 'bridge_pontic', 'prosthesis'];

function setKey<T>(setter: Setter<T>, fdi: string, value: T | undefined) {
  setter((prev) => {
    const next = { ...prev };
    if (value === undefined) delete next[fdi];
    else next[fdi] = value;
    return next;
  });
}

/**
 * A bridge by voice, with the same rules as "Člen mostu" on the chart: one
 * jaw, anchors (crown / implant) of one type, at least one pontic. The teeth
 * from the first to the last named form the bridge; if none of them is an
 * anchor yet, the two ends become crowns ("most od 14 do 12").
 */
function planBridge(
  fdis: string[],
  statusOf: (fdi: string) => ToothStatus | undefined
): { range: string[]; anchors: string[]; pontics: string[]; newCrowns: string[] } | { error: string } {
  const range = bridgeRange(fdis);
  if (!range) return { error: 'most: zobje morajo biti v isti čeljusti' };
  const isAnchor = (s: ToothStatus | undefined) => s === 'crown' || s === 'implant';
  let anchors = range.filter((f) => isAnchor(statusOf(f)));
  let newCrowns: string[] = [];
  if (anchors.length === 0) {
    anchors = [...new Set([range[0], range[range.length - 1]])];
    newCrowns = anchors;
  }
  if (new Set(anchors.map(statusOf).filter(Boolean)).size > 1) {
    return { error: 'most: sidri morata biti istega tipa — obe prevleki ali oba implantata' };
  }
  const pontics = range.filter((f) => !anchors.includes(f));
  if (pontics.length === 0) return { error: 'most: med sidroma mora biti vsaj en člen' };
  return { range, anchors, pontics, newCrowns };
}

interface Options {
  maps: ChartMaps;
  setters: ChartSetters;
  /** Statuses that apply to the whole tooth even when a surface is named. */
  isWholeToothStatus: (status: ToothStatus) => boolean;
  onSelectTooth: (fdi: string) => void;
  /** The practice's taught words (useVoiceAliases). */
  aliases: Record<string, string>;
}

export function useVoiceChartEntry({ maps, setters, isWholeToothStatus, onSelectTooth, aliases }: Options) {
  const aliasesRef = useRef(aliases);
  useEffect(() => {
    aliasesRef.current = aliases;
  });
  const [log, setLog] = useState<VoiceLogEntry[]>([]);
  const mapsRef = useRef(maps);
  useEffect(() => {
    mapsRef.current = maps;
  });
  const contextRef = useRef<VoiceContext>({ currentFdi: null, lastPerio: null, lastFinding: null });
  // When the last filling/caries was said — a surfaces-only phrase completes it
  // within FINDING_WINDOW_MS.
  const findingAtRef = useRef(0);
  const undoStack = useRef<{ entryId: number; snapshots: ToothSnapshot[] }[]>([]);
  const nextId = useRef(1);
  const [undoDepth, setUndoDepth] = useState(0);

  const undo = useCallback(() => {
    const last = undoStack.current.pop();
    setUndoDepth(undoStack.current.length);
    if (!last) return;
    for (const snap of last.snapshots) {
      const { fdi } = snap;
      setKey(setters.setSurfacesByFdi, fdi, snap.surfacesByFdi);
      setKey(setters.setNotesByFdi, fdi, snap.notesByFdi);
      setKey(setters.setPostByFdi, fdi, snap.postByFdi);
      setKey(setters.setEndoByFdi, fdi, snap.endoByFdi);
      setKey(setters.setPocketsBuccalByFdi, fdi, snap.pocketsBuccalByFdi);
      setKey(setters.setPocketsLingualByFdi, fdi, snap.pocketsLingualByFdi);
      setKey(setters.setGumMarginByFdi, fdi, snap.gumMarginByFdi);
      setKey(setters.setBleedingBuccalByFdi, fdi, snap.bleedingBuccalByFdi);
      setKey(setters.setBleedingLingualByFdi, fdi, snap.bleedingLingualByFdi);
      setKey(setters.setBridgeGroupByFdi, fdi, snap.bridgeGroupByFdi);
    }
    setLog((prev) => prev.map((e) => (e.id === last.entryId ? { ...e, undone: true } : e)));
  }, [setters]);

  const apply = useCallback(
    (cmd: VoiceCommand) => {
      const s = setters;
      switch (cmd.kind) {
        case 'status':
          if (cmd.amend) {
            // Completing the previous phrase's finding: its whole-tooth mark
            // becomes the named surfaces.
            s.setSurfacesByFdi((prev) => {
              const current = { ...(prev[cmd.fdi] ?? {}) };
              if (current.all === cmd.status) delete current.all;
              for (const surface of cmd.surfaces) current[surface] = cmd.status;
              return { ...prev, [cmd.fdi]: current };
            });
          } else if (cmd.surfaces.length === 0 || isWholeToothStatus(cmd.status)) {
            s.setSurfacesByFdi((prev) => ({ ...prev, [cmd.fdi]: { all: cmd.status } }));
          } else {
            s.setSurfacesByFdi((prev) => {
              const current = { ...(prev[cmd.fdi] ?? {}) };
              // A per-surface finding on a tooth marked as a whole drops the
              // whole-tooth mark, like picking a surface in the panel does.
              if (current.all && !['caries', 'caries_treated', 'filling', 'healthy'].includes(current.all)) delete current.all;
              for (const surface of cmd.surfaces) current[surface] = cmd.status;
              return { ...prev, [cmd.fdi]: current };
            });
          }
          break;
        case 'endo':
          setKey(s.setEndoByFdi, cmd.fdi, cmd.stage);
          break;
        case 'post':
          setKey(s.setPostByFdi, cmd.fdi, cmd.on ? true : undefined);
          break;
        case 'pocket': {
          const pockets = cmd.side === 'buccal' ? s.setPocketsBuccalByFdi : s.setPocketsLingualByFdi;
          pockets((prev) => {
            const cur = prev[cmd.fdi] ?? [null, null, null];
            const next = cur.map((v, i) => cmd.values[i] ?? v) as PocketDepths;
            return { ...prev, [cmd.fdi]: next };
          });
          if (cmd.bleeding) {
            const bleeding = cmd.side === 'buccal' ? s.setBleedingBuccalByFdi : s.setBleedingLingualByFdi;
            const marks = cmd.bleeding;
            bleeding((prev) => {
              const cur = prev[cmd.fdi] ?? [false, false, false];
              return { ...prev, [cmd.fdi]: cur.map((v, i) => v || marks[i]) as BleedingPoints };
            });
          }
          break;
        }
        case 'recession':
          s.setGumMarginByFdi((prev) => {
            const cur = prev[cmd.fdi] ?? [null, null, null];
            // Recession is below the CEJ — stored negative (see GumMargin).
            const next = cur.map((v, i) => (cmd.values[i] == null ? v : -(cmd.values[i] as number))) as GumMargin;
            return { ...prev, [cmd.fdi]: next };
          });
          break;
        case 'note':
          s.setNotesByFdi((prev) => {
            const cur = prev[cmd.fdi]?.trim();
            return { ...prev, [cmd.fdi]: cur ? `${cur}\n${cmd.text}` : cmd.text };
          });
          break;
        default:
          break;
      }
    },
    [setters, isWholeToothStatus]
  );

  // Kept in a ref so the speech callback always sees the latest version.
  const handleTextRef = useRef<(alternatives: string[]) => void>(() => {});
  const speech = useSpeechRecognition((alternatives) => handleTextRef.current(alternatives));

  handleTextRef.current = (alternatives: string[]) => {
    const surfaces = mapsRef.current.surfacesByFdi;
    const skip = (fdi: string) => {
      const all = surfaces[fdi]?.all;
      return !!all && NOT_PROBED.includes(all);
    };
    // Parse every guess the recogniser offered and keep the one that makes
    // the most sense: real changes count most, naming a tooth helps, words
    // that weren't understood count against; ties go to the recogniser's
    // own first choice.
    if (contextRef.current.lastFinding && Date.now() - findingAtRef.current > FINDING_WINDOW_MS) {
      contextRef.current = { ...contextRef.current, lastFinding: null };
    }
    const findingBefore = contextRef.current.lastFinding;
    let text = alternatives[0];
    let result = parseVoiceCommand(text, contextRef.current, skip, aliasesRef.current);
    const score = (r: typeof result) =>
      r.commands.reduce((sum, c) => sum + (c.kind === 'select' ? 1 : 3), 0) - 2 * r.unknown.length;
    for (const alt of alternatives.slice(1)) {
      const candidate = parseVoiceCommand(alt, contextRef.current, skip, aliasesRef.current);
      if (score(candidate) > score(result)) {
        result = candidate;
        text = alt;
      }
    }
    contextRef.current = result.context;
    if (result.context.lastFinding !== findingBefore) findingAtRef.current = Date.now();

    const id = nextId.current++;
    const snapshots: ToothSnapshot[] = [];
    const applied: string[] = [];
    const unknown = [...result.unknown];
    const remember = (fdi: string) => {
      if (snapshots.some((snap) => snap.fdi === fdi)) return;
      const m = mapsRef.current;
      const snap = { fdi } as ToothSnapshot;
      for (const key of MAP_KEYS) (snap as Record<string, unknown>)[key] = m[key][fdi];
      snapshots.push(snap);
    };
    // Whole-tooth statuses set earlier in this same phrase (state updates
    // aren't visible yet) — "14 krona 12 krona most" needs them.
    const setInPhrase: Record<string, ToothStatus> = {};
    for (const cmd of result.commands) {
      if (cmd.kind === 'undo') {
        undo();
        continue;
      }
      if (cmd.kind === 'stop') {
        speech.stop();
        applied.push('mikrofon izklopljen');
        continue;
      }
      if (cmd.kind === 'select') {
        onSelectTooth(cmd.fdi);
        continue;
      }
      if (cmd.kind === 'info') {
        applied.push(cmd.label);
        continue;
      }
      if (cmd.kind === 'bridge') {
        const plan = planBridge(cmd.fdis, (f) => setInPhrase[f] ?? mapsRef.current.surfacesByFdi[f]?.all);
        if ('error' in plan) {
          unknown.push(plan.error);
          continue;
        }
        plan.range.forEach(remember);
        setters.setSurfacesByFdi((prev) => {
          const next = { ...prev };
          for (const f of plan.newCrowns) next[f] = { all: 'crown' };
          for (const f of plan.pontics) next[f] = { all: 'bridge_pontic' };
          return next;
        });
        const groupId = `bridge-${plan.range.join('_')}-${Date.now()}`;
        setters.setBridgeGroupByFdi((prev) => {
          const next = { ...prev };
          for (const f of plan.range) next[f] = groupId;
          return next;
        });
        applied.push(
          `most ${plan.range[0]}–${plan.range[plan.range.length - 1]}: sidri ${plan.anchors.join(', ')}${
            plan.newCrowns.length ? ' (krona)' : ''
          } · člen ${plan.pontics.join(', ')}`
        );
        continue;
      }
      remember(cmd.fdi);
      apply(cmd);
      if (cmd.kind === 'status' && cmd.surfaces.length === 0) setInPhrase[cmd.fdi] = cmd.status;
      applied.push(cmd.label);
    }
    if (snapshots.length) {
      undoStack.current.push({ entryId: id, snapshots });
      setUndoDepth(undoStack.current.length);
    }
    if (applied.length || unknown.length) {
      setLog((prev) => [...prev.slice(-29), { id, heard: text, applied, unknown, unknownWords: result.unknownWords, undone: false }]);
    }
  };

  const start = () => {
    contextRef.current = { currentFdi: null, lastPerio: null, lastFinding: null };
    speech.start();
  };

  return {
    supported: speech.supported,
    listening: speech.listening,
    interim: speech.interim,
    error: speech.error,
    start,
    stop: speech.stop,
    undo,
    canUndo: undoDepth > 0,
    log,
    clearLog: () => setLog([]),
    /** Runs a phrase again, e.g. right after teaching one of its words. */
    reprocess: (text: string, withAliases: Record<string, string>) => {
      aliasesRef.current = withAliases;
      // Teaching takes a moment — the phrase may still complete the finding
      // before it ("23 plomba" … "miz").
      findingAtRef.current = Date.now();
      handleTextRef.current([text]);
    },
  };
}
