// Which tooth each chart position shows, per patient (migration 062; Gregor,
// 2026-11-13). The chart keeps its 32 positions; patients.dentition records
// only the exceptions, keyed by the position's permanent FDI:
//   'deciduous' — the milk tooth is there (position 14 shows 54),
//   'unerupted' — the permanent tooth hasn't come through yet (no side view,
//                 a light-grey empty tloris square; no perio).
// Absent = the permanent tooth, as for every adult.
import { LOWER_LEFT, LOWER_RIGHT, TOOTH_META, UPPER_LEFT, UPPER_RIGHT, deciduousAt } from '../data/toothMeta';

export type PositionState = 'deciduous' | 'unerupted';
export type Dentition = Record<string, PositionState>;

export interface ChartQuadrants {
  upperLeft: string[];
  upperRight: string[];
  lowerLeft: string[];
  lowerRight: string[];
}

export const PERMANENT_QUADRANTS: ChartQuadrants = {
  upperLeft: UPPER_LEFT,
  upperRight: UPPER_RIGHT,
  lowerLeft: LOWER_LEFT,
  lowerRight: LOWER_RIGHT,
};

/** The tooth number shown at each position. */
export function chartQuadrants(dentition: Dentition): ChartQuadrants {
  const show = (positions: string[]) => positions.map((p) => (dentition[p] === 'deciduous' ? deciduousAt(p) ?? p : p));
  return {
    upperLeft: show(UPPER_LEFT),
    upperRight: show(UPPER_RIGHT),
    lowerLeft: show(LOWER_LEFT),
    lowerRight: show(LOWER_RIGHT),
  };
}

/** Positions whose permanent tooth hasn't come through yet. */
export function uneruptedPositions(dentition: Dentition): Set<string> {
  return new Set(Object.entries(dentition).filter(([, s]) => s === 'unerupted').map(([p]) => p));
}

/** A small child: milk teeth at positions 1–5, the permanent molars (6–8)
 *  not yet through (Gregor). Adjusted tooth by tooth afterwards. */
export function childDentition(): Dentition {
  const d: Dentition = {};
  for (const p of [...UPPER_LEFT, ...UPPER_RIGHT, ...LOWER_LEFT, ...LOWER_RIGHT]) {
    d[p] = deciduousAt(p) ? 'deciduous' : 'unerupted';
  }
  return d;
}

/** The chart position (permanent FDI) of any shown tooth number. */
export function positionOf(fdi: string): string {
  return TOOTH_META[fdi]?.positionFdi ?? fdi;
}

/** True when the patient has any milk teeth or not-yet-erupted positions. */
export function hasChildDentition(dentition: Dentition): boolean {
  return Object.keys(dentition).length > 0;
}
