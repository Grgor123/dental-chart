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
