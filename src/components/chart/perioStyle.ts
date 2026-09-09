// Shared between PerioGraphRow, PocketDepthRow, and StatusLegend so all
// three stay visually consistent (same severity colors, same
// mesial/mid/distal x-positions, same BOP mark color).
export const POINT_X_FRACTIONS = [0.2, 0.5, 0.8]; // mesial, mid, distal — within a tooth's column width

export function pdColor(depthMm: number): string {
  if (depthMm >= 4) return '#D4537E';
  if (depthMm === 3) return '#EF9F27';
  return '#6f7c79';
}

// Bleeding on probing (BOP) ring color — same red as a ≥4mm pocket depth
// reading, since both flag the same underlying severity, just via
// different geometry (a thick ring vs. the number's own color).
export const BOP_COLOR = '#D4537E';

// Identifies one probing point for the click-to-focus/type-a-number entry
// flow (PatientChart.tsx) — a pocket-depth point (needs which surface, since
// PocketDepthRow is rendered once per surface per quadrant) or a gum-margin
// point (buccal only, per the app's existing "one gumline" simplification —
// see PerioGraphRow — so no surface field there). Shared here, not defined
// separately in each row component, since PatientChart.tsx's focus state and
// both row components all need the exact same shape to compare against.
export type PerioPoint =
  | { kind: 'pocket'; fdi: string; surface: 'buccal' | 'lingual'; index: 0 | 1 | 2 }
  | { kind: 'gum'; fdi: string; index: 0 | 1 | 2 };

export function samePerioPoint(a: PerioPoint | null | undefined, b: PerioPoint): boolean {
  if (!a || a.kind !== b.kind || a.fdi !== b.fdi || a.index !== b.index) return false;
  if (a.kind === 'pocket' && b.kind === 'pocket') return a.surface === b.surface;
  return true;
}
