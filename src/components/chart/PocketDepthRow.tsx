import { COLUMN_WIDTH, COLUMN_GAP } from '../../data/toothProfiles';
import type { PocketDepths, BleedingPoints, ToothStatus } from '../../types/dental';
import { POINT_X_FRACTIONS, pdColor, BOP_COLOR, samePerioPoint, type PerioPoint } from './perioStyle';

const ROW_HEIGHT = 16;
const POINT_RADIUS = 5;
// Generous invisible hit target — real points sit only ~12px apart
// (COLUMN_WIDTH × the 0.3 gap between POINT_X_FRACTIONS), so this is sized
// to make each point comfortably tappable without overlapping its neighbors,
// well past the visible circle's own 5px radius.
const HIT_RADIUS = 7;
const SELECTED_COLOR = 'var(--tooth-selected, #2e6e62)';
// Faint placeholder for an interactive-but-not-yet-entered point — without
// this there was nothing to see at all where a point could be clicked (the
// hit circle itself is fully invisible, fill/stroke "none"), which read as
// "there's nothing here" rather than "click here to enter a value." Only
// shown when the row is actually interactive (PatientChart.tsx) — the
// read-only StatusShowcase.tsx chart keeps its original "nothing shows
// until real data exists" look, since there's no click to invite there.
const PLACEHOLDER_COLOR = '#ccd6d4';

type PocketPoint = Extract<PerioPoint, { kind: 'pocket' }>;

interface PocketDepthRowProps {
  fdis: readonly string[];
  /** Which surface this row instance shows — needed to build correct point identities for onPointClick/focusedPoint, since this component is rendered once per surface per quadrant (see ArchRow.tsx). */
  surface: 'buccal' | 'lingual';
  pockets?: Record<string, PocketDepths>;
  bleeding?: Record<string, BleedingPoints>;
  /** Whole-tooth status per fdi — the only thing this row needs it for is excluding impacted teeth from entry (nothing to probe on a tooth that's never erupted, same rule PerioGraphRow already applies to REC). */
  statuses?: Record<string, ToothStatus>;
  /** Click-to-focus/type-a-number entry (PatientChart.tsx) — see PerioPoint. Optional: StatusShowcase.tsx's read-only chart simply never passes these, so nothing there becomes interactive. */
  onPointClick?: (point: PocketPoint) => void;
  focusedPoint?: PerioPoint | null;
}

// One row of probing-depth readings for a whole quadrant, positioned by
// ArchRow directly against the top-view (tloris) row — one row above it,
// one below — so both the vestibular and oral surface are visible at once
// per Monika's request, instead of a single surface buried out at the root
// tips where the two couldn't be told apart.
export function PocketDepthRow({ fdis, surface, pockets, bleeding, statuses, onPointClick, focusedPoint }: PocketDepthRowProps) {
  return (
    <div className="flex items-start" style={{ gap: `${COLUMN_GAP}px` }}>
      {fdis.map((fdi) => {
        const depths = pockets?.[fdi];
        const bop = bleeding?.[fdi];
        // Impacted teeth have never erupted — nothing to probe, same rule
        // PerioGraphRow already applies to REC entry.
        const interactive = !!onPointClick && statuses?.[fdi] !== 'impacted';
        return (
          <div key={fdi} className="flex flex-none justify-center" style={{ width: `${COLUMN_WIDTH}px`, height: `${ROW_HEIGHT}px` }}>
            <svg width={COLUMN_WIDTH} height={ROW_HEIGHT} viewBox={`0 0 ${COLUMN_WIDTH} ${ROW_HEIGHT}`} role="img" aria-label={`Globina žepka ${fdi}`}>
              {([0, 1, 2] as const).map((i) => {
                const x = COLUMN_WIDTH * POINT_X_FRACTIONS[i];
                const y = ROW_HEIGHT / 2;
                const depthMm = depths?.[i];
                const point: PocketPoint = { kind: 'pocket', fdi, surface, index: i };
                const focused = interactive && samePerioPoint(focusedPoint, point);
                // Bleeding on probing (BOP): the point's own circle outline
                // turns red and 3px thick instead of the usual thin
                // depth-colored ring. There's no room for a separate
                // concentric ring at this spacing (points sit ~12px apart,
                // barely more than the circle's own diameter), so BOP marks
                // the existing circle directly rather than adding a second one.
                const bleeds = bop?.[i] ?? false;
                return (
                  <g key={i}>
                    {focused && <circle cx={x} cy={y} r={HIT_RADIUS} fill="none" stroke={SELECTED_COLOR} strokeWidth={1.5} />}
                    {interactive && depthMm == null && (
                      <circle cx={x} cy={y} r={POINT_RADIUS} fill="none" stroke={PLACEHOLDER_COLOR} strokeWidth={1} strokeDasharray="1.5 1.5" />
                    )}
                    {depthMm != null && (
                      <>
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
                      </>
                    )}
                    {/* Invisible hit circle, always present (when
                        interactive) regardless of whether a value has been
                        entered yet — otherwise there'd be nothing to click
                        to start entering an empty point (see CLAUDE.md's
                        own "no entry = nothing shown" principle, which
                        stays true for the visible circle/number above;
                        this is purely a click target underneath it). Drawn
                        last so it always wins the click regardless of what
                        else is painted at this point. */}
                    {interactive && (
                      <circle
                        cx={x}
                        cy={y}
                        r={HIT_RADIUS}
                        fill="none"
                        stroke="none"
                        style={{ pointerEvents: 'all', cursor: 'pointer' }}
                        onClick={() => onPointClick?.(point)}
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
