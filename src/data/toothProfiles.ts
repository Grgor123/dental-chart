// Sizing model for the traced side-view artwork. Two things come from
// different sources and are combined here:
//  - SHAPE (silhouette outline, root divisions, fissures) comes from
//    Monika's own traced tooth photos (tracedTeeth.json).
//  - SIZE (how tall/wide each tooth renders, and where the gumline sits)
//    comes from real average adult tooth dimensions (toothAnatomy.ts), not
//    from the photos. The 32 source photos were cropped independently with
//    no shared scale reference, so their pixel dimensions can't be trusted
//    for absolute or even relative size — only for each tooth's own
//    silhouette shape. This is what makes every tooth's size mean something
//    in real mm (needed for the perio-measurement ruler/graph) rather than
//    "whatever made the layout look tidy."
import { svgPathProperties } from 'svg-path-properties';
import tracedTeeth from './tracedTeeth.json';
import { TOOTH_META, ALL_FDI } from './toothMeta';
import { TOOTH_ANATOMY_MM } from './toothAnatomy';

interface TracedTooth {
  d: string;
  detailD: string;
  width: number;
  height: number;
}

const traced = tracedTeeth as unknown as Record<string, TracedTooth>;

export interface ToothProfile {
  fdi: string;
  silhouette: string;
  detail: string;
  /** true source pixel size of the traced photo */
  width: number;
  height: number;
  /** on-screen size in the side-view SVG's own viewBox units */
  displayWidth: number;
  displayHeight: number;
  /** y-coordinate (in source pixel space) of the crown/root boundary (CEJ) */
  gingivaY: number;
  /**
   * x-coordinate (source pixel space) of the crown silhouette's own
   * horizontal midpoint — NOT width/2. A traced crown isn't necessarily
   * centered in its own bounding box (cusps/curvature lean one way or the
   * other), so width/2 visibly mis-centered ImplantFixture's screw under
   * some crowns. Sampled once here via svg-path-properties rather than at
   * render time, so it's a plain number everywhere else uses it.
   */
  crownCenterX: number;
  /** real-world total tooth length this display size represents, mm */
  totalLengthMm: number;
  crownLengthMm: number;
  rootLengthMm: number;
}

// One shared px-per-mm scale for the whole chart — this is what makes sizes
// comparable across different tooth types, not just within one position.
// Tuned so a typical incisor lands close to the same on-screen size the
// chart has always used. Exported so the perio ruler/graph (which plots
// real mm measurements) uses the exact same scale as the tooth artwork.
export const PX_PER_MM = 3;

// Walks the traced silhouette at regular arc-length intervals (not just its
// bezier control points, which can overshoot the actual curve) and takes
// the min/max x among only the samples that fall within the crown's own
// y-range — i.e. the crown's true horizontal midpoint, not the combined
// crown+root bounding box's.
function estimateCrownCenterX(pathD: string, crownYMin: number, crownYMax: number, fallback: number): number {
  try {
    const path = new svgPathProperties(pathD);
    const total = path.getTotalLength();
    const sampleCount = 200;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i <= sampleCount; i++) {
      const { x, y } = path.getPointAtLength((total * i) / sampleCount);
      if (y >= crownYMin && y <= crownYMax) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    return minX === Infinity ? fallback : (minX + maxX) / 2;
  } catch {
    return fallback;
  }
}

function buildProfiles(): Record<string, ToothProfile> {
  const profiles: Record<string, ToothProfile> = {};
  for (const fdi of ALL_FDI) {
    const meta = TOOTH_META[fdi];
    const t = traced[fdi];
    const anatomy = TOOTH_ANATOMY_MM[meta.arch][meta.position];
    const totalLengthMm = anatomy.crownLengthMm + anatomy.rootLengthMm;
    const crownFraction = anatomy.crownLengthMm / totalLengthMm;

    const gingivaY = meta.arch === 'upper'
      ? Math.round(t.height * (1 - crownFraction))
      : Math.round(t.height * crownFraction);

    const displayHeight = totalLengthMm * PX_PER_MM;
    // Preserve this tooth's own traced aspect ratio — only height is
    // anchored to real mm; width just follows the same scale factor so the
    // silhouette isn't stretched.
    const displayWidth = t.width * (displayHeight / t.height);

    // Same crown y-range convention as ToothSideViewContent's crownTop/
    // crownHeight: upper crown hangs from gingivaY down to the photo's
    // bottom edge; lower crown sits from the top edge down to gingivaY.
    const crownYMin = meta.arch === 'upper' ? gingivaY : 0;
    const crownYMax = meta.arch === 'upper' ? t.height : gingivaY;
    const crownCenterX = estimateCrownCenterX(t.d, crownYMin, crownYMax, t.width / 2);

    profiles[fdi] = {
      fdi,
      silhouette: t.d,
      detail: t.detailD,
      width: t.width,
      height: t.height,
      displayWidth,
      displayHeight,
      gingivaY,
      crownCenterX,
      totalLengthMm,
      crownLengthMm: anatomy.crownLengthMm,
      rootLengthMm: anatomy.rootLengthMm,
    };
  }
  return profiles;
}

export const TOOTH_PROFILES: Record<string, ToothProfile> = buildProfiles();

// Every column — every tooth, both arches — shares one fixed width, sized
// to comfortably fit the widest tooth in the whole set (currently 36).
// Per Monika's feedback: matching column width to each pair's own widest
// tooth (so 18 lines up above 48, etc.) made narrower teeth sit in a much
// wider box than they needed, centered with uneven leftover space — the
// visible "gap" between neighbors varied depending on how much slack each
// tooth had, worst around the molars. A single fixed width makes every
// column contribute the same footprint to the row, so the flex gap between
// columns reads as genuinely uniform everywhere, and upper/lower alignment
// falls out for free since every column is the same size regardless of
// position. Trade-off: tooth width is no longer to real-world scale (only
// height still is) — this is a deliberate layout choice, not a data gap.
export const COLUMN_WIDTH: number = Math.max(...Object.values(TOOTH_PROFILES).map((p) => p.displayWidth)) + 3;

// Horizontal gap between columns (ArchRow's flex `gap`). Exported so
// PerioGraphRow can compute the exact same cumulative x-positions and line
// up with the top-view row underneath it.
export const COLUMN_GAP = 4;
