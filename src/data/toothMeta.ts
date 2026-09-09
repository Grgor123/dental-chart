import type { AntSurface, PostSurface, Surface, ToothType } from '../types/dental';

export type Arch = 'upper' | 'lower';
export type ToothPosition =
  | 'incisor_central' | 'incisor_lateral' | 'canine'
  | 'premolar1' | 'premolar2' | 'molar1' | 'molar2' | 'molar3';

export interface ToothMeta {
  fdi: string;
  quadrant: 1 | 2 | 3 | 4;
  position: ToothPosition;
  arch: Arch;
  type: ToothType;
  rootCount: number;
  surfaces: readonly Surface[];
}

const POSITION_BY_SLOT: Record<number, ToothPosition> = {
  1: 'incisor_central', 2: 'incisor_lateral', 3: 'canine',
  4: 'premolar1', 5: 'premolar2', 6: 'molar1', 7: 'molar2', 8: 'molar3',
};

const ARCH_BY_QUADRANT: Record<1 | 2 | 3 | 4, Arch> = {
  1: 'upper', 2: 'upper', 3: 'lower', 4: 'lower',
};

const ANT_SURFACES: readonly AntSurface[] = ['b', 'l', 'm', 'd'];
const POST_SURFACES: readonly PostSurface[] = ['b', 'o', 'l', 'm', 'd'];

// Root counts are the common/typical case for each position; real teeth vary
// (fused roots, extra roots) but this is enough for ToothData.rootCount.
// (No per-canal-count UI reads this — the chart's own endo marker is a
// single circle regardless of how many real canals a molar has; see
// "Canal display" in CLAUDE.md.)
const ROOT_COUNT: Record<ToothPosition, Record<Arch, number>> = {
  incisor_central: { upper: 1, lower: 1 },
  incisor_lateral: { upper: 1, lower: 1 },
  canine: { upper: 1, lower: 1 },
  premolar1: { upper: 2, lower: 1 },
  premolar2: { upper: 1, lower: 1 },
  molar1: { upper: 3, lower: 2 },
  molar2: { upper: 3, lower: 2 },
  molar3: { upper: 3, lower: 2 },
};

function buildToothMeta(): Record<string, ToothMeta> {
  const meta: Record<string, ToothMeta> = {};
  for (const quadrant of [1, 2, 3, 4] as const) {
    for (let slot = 1; slot <= 8; slot++) {
      const fdi = `${quadrant}${slot}`;
      const position = POSITION_BY_SLOT[slot];
      const arch = ARCH_BY_QUADRANT[quadrant];
      const type: ToothType = slot <= 3 ? 'ant' : 'post';
      meta[fdi] = {
        fdi,
        quadrant,
        position,
        arch,
        type,
        rootCount: ROOT_COUNT[position][arch],
        surfaces: type === 'ant' ? ANT_SURFACES : POST_SURFACES,
      };
    }
  }
  return meta;
}

export const TOOTH_META: Record<string, ToothMeta> = buildToothMeta();

export const UPPER_LEFT = ['18', '17', '16', '15', '14', '13', '12', '11'];
export const UPPER_RIGHT = ['21', '22', '23', '24', '25', '26', '27', '28'];
export const LOWER_LEFT = ['48', '47', '46', '45', '44', '43', '42', '41'];
export const LOWER_RIGHT = ['31', '32', '33', '34', '35', '36', '37', '38'];
export const ALL_FDI = [...UPPER_LEFT, ...UPPER_RIGHT, ...LOWER_LEFT, ...LOWER_RIGHT];

// Slovene surface names for the click-to-edit surface chips
// (ToothDetailPanel.tsx via SurfaceChip.tsx) — type-aware because 'b' means
// something different per tooth type: bukalna (cheek side) on a posterior
// tooth, but labialna (lip side) on an anterior one, per the exact terms
// already used in dental.ts's own Surface/PostSurface/AntSurface comments.
// 'l' is "lingvalna" for both arches there too (not a separate palatinalna
// term for the upper arch) — this function follows that same simplification
// rather than introducing a distinction the rest of the app doesn't make.
const ANT_SURFACE_LABELS: Record<AntSurface, string> = {
  b: 'Labialna', l: 'Lingvalna', m: 'Mezialna', d: 'Distalna',
};
const POST_SURFACE_LABELS: Record<PostSurface, string> = {
  b: 'Bukalna', o: 'Okluzalna', l: 'Lingvalna', m: 'Mezialna', d: 'Distalna',
};

export function surfaceLabel(type: ToothType, surface: Surface): string {
  return type === 'ant' ? ANT_SURFACE_LABELS[surface as AntSurface] : POST_SURFACE_LABELS[surface as PostSurface];
}
