import type { Surface, SurfaceMap, ToothStatus, EndoStage } from '../types/dental';
import { TOOTH_META, surfaceLabel } from '../data/toothMeta';
import { STATUS_STYLES, ENDO_STAGE_LABELS } from '../data/statusStyles';

// Turns one tooth_records row into a flat list of human-readable summary
// lines — "Cel zob: Abrazija", "Zobni zatiček", etc. Shared by every
// history view built on this data (ToothDetailPanel.tsx's own per-tooth
// "Zgodovina" tab, and PatientChart.tsx's Frame 8 cross-tooth rollup via
// usePatientHistory.ts) so they can't drift apart on what counts as
// "something happened this visit" or how it reads. No bullet/prefix
// formatting here — callers render each line however their own list
// markup wants to (a bare `<li>• {line}</li>`, or "Zob {fdi}: {line}" for
// a cross-tooth view that needs to say which tooth each line belongs to).
export interface ToothRecordFields {
  surfaces: SurfaceMap | null;
  post: boolean;
  endo: EndoStage | null;
  notes: string | null;
}

export function describeToothRecord(entry: ToothRecordFields, fdi: string): string[] {
  const lines: string[] = [];
  const wholeStatus = entry.surfaces?.all;
  if (wholeStatus) lines.push(`Cel zob: ${STATUS_STYLES[wholeStatus].label}`);
  // Every OTHER surface set on this row, besides `all` — the same
  // per-surface findings a real exam can layer on top of (or instead of) a
  // whole-tooth status.
  if (entry.surfaces) {
    const surfaceEntries = Object.entries(entry.surfaces).filter(([key]) => key !== 'all') as [Surface, ToothStatus][];
    for (const [surface, status] of surfaceEntries) {
      lines.push(`${surfaceLabel(TOOTH_META[fdi].type, surface)}: ${STATUS_STYLES[status].label}`);
    }
  }
  if (entry.post) lines.push('Zobni zatiček');
  if (entry.endo) lines.push(ENDO_STAGE_LABELS[entry.endo]);
  if (entry.notes) lines.push(`Opomba: ${entry.notes}`);
  return lines;
}
