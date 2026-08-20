import { COLUMN_WIDTH, COLUMN_GAP } from '../../data/toothProfiles';
import type { PocketDepths, BleedingPoints } from '../../types/dental';
import { POINT_X_FRACTIONS, pdColor, BOP_COLOR } from './perioStyle';

const ROW_HEIGHT = 16;
const POINT_RADIUS = 5;

interface PocketDepthRowProps {
  fdis: readonly string[];
  pockets?: Record<string, PocketDepths>;
  bleeding?: Record<string, BleedingPoints>;
}

// One row of probing-depth readings for a whole quadrant, positioned by
// ArchRow directly against the top-view (tloris) row — one row above it,
// one below — so both the vestibular and oral surface are visible at once
// per Monika's request, instead of a single surface buried out at the root
// tips where the two couldn't be told apart.
export function PocketDepthRow({ fdis, pockets, bleeding }: PocketDepthRowProps) {
  return (
    <div className="flex items-start" style={{ gap: `${COLUMN_GAP}px` }}>
      {fdis.map((fdi) => {
        const depths = pockets?.[fdi];
        const bop = bleeding?.[fdi];
        return (
          <div key={fdi} className="flex flex-none justify-center" style={{ width: `${COLUMN_WIDTH}px`, height: `${ROW_HEIGHT}px` }}>
            {depths && (
              <svg width={COLUMN_WIDTH} height={ROW_HEIGHT} viewBox={`0 0 ${COLUMN_WIDTH} ${ROW_HEIGHT}`} role="img" aria-label={`Globina žepka ${fdi}`}>
                {depths.map((depthMm, i) => {
                  const x = COLUMN_WIDTH * POINT_X_FRACTIONS[i];
                  const y = ROW_HEIGHT / 2;
                  // Bleeding on probing (BOP): the point's own circle outline
                  // turns red and 3px thick instead of the usual thin
                  // depth-colored ring. There's no room for a separate
                  // concentric ring at this spacing (points sit ~12px apart,
                  // barely more than the circle's own diameter), so BOP marks
                  // the existing circle directly rather than adding a second one.
                  const bleeds = bop?.[i] ?? false;
                  return (
                    <g key={i}>
                      <circle
                        cx={x}
                        cy={y}
                        r={POINT_RADIUS}
                        fill="#fff"
                        stroke={bleeds ? BOP_COLOR : pdColor(depthMm)}
                        strokeWidth={bleeds ? 3 : 1.5}
                      />
                      <text x={x} y={y + 0.5} fontSize={7} textAnchor="middle" dominantBaseline="middle" fill={pdColor(depthMm)}>
                        {depthMm}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}
