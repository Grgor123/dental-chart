import { TOOTH_META } from '../../data/toothMeta';
import { COLUMN_WIDTH, COLUMN_GAP } from '../../data/toothProfiles';
import type { SurfaceMap, ToothStatus } from '../../types/dental';
import { ToothTopView } from './ToothTopView';

// A tooth joins the prosthesis connector line if it's the denture tooth
// itself (`prosthesis`, drawn as a hollow circle+X) *or* a natural crowned
// tooth anchoring/participating in that same prosthesis (`prosthesis_crown`,
// drawn as a completely ordinary crown) — per Monika's explicit request
// that the two connect exactly the same way. Exported so ArchRow.tsx's
// cross-midline check uses the identical rule.
export function isProsthesisLink(status: ToothStatus | undefined): boolean {
  return status === 'prosthesis' || status === 'prosthesis_crown';
}

interface TlorisRowProps {
  fdis: readonly string[];
  onSelect?: (fdi: string) => void;
  selectedFdi?: string;
  surfacesByFdi?: Record<string, SurfaceMap>;
  /** Draw a half-segment from this quadrant's *first* tooth out toward the
   * shared midline gap — the other half of a connector whose other half is
   * drawn by the neighboring quadrant's own TlorisRow (see ArchRow.tsx). */
  connectToPrev?: boolean;
  /** Same idea, from this quadrant's *last* tooth out toward the shared
   * midline gap on its far side. */
  connectToNext?: boolean;
  /** Which teeth show the dental-post line — see ToothTopView's `hasPost`. */
  postByFdi?: Record<string, boolean>;
}

// Exported so BridgeRow.tsx can size its overlay cap to match the
// square's own true edge length exactly, rather than a duplicated literal.
export const TOOTH_SIZE = 26;
// Half the leftover space in each column once the fixed 26px tooth square
// sits centered inside it (COLUMN_WIDTH is wider than 26 to fit the widest
// tooth's own silhouette — see toothProfiles.ts) — needed to find exactly
// where a tooth's own square (and so its prosthesis circle) starts/ends
// within its column, for the connector line below.
const COLUMN_MARGIN = (COLUMN_WIDTH - TOOTH_SIZE) / 2;
const CONNECTOR_COLOR = '#1f1e20';
// The two quadrants in an ArchRow now sit exactly COLUMN_GAP apart (see
// ArchRow.tsx) — the same gap as any two ordinary neighboring teeth — so a
// connector crossing the midline splits into two HALF_GAP segments, one
// drawn by each quadrant's own TlorisRow reaching toward its own outer
// edge, meeting exactly at the gap's midpoint (where ArchRow's own divider
// line sits) with no separate cross-quadrant layout math needed.
const HALF_GAP = COLUMN_GAP / 2;

// Adjacent prosthesis teeth (isProsthesisLink — the removable-denture
// tooth itself, or a natural crowned tooth anchoring/participating in the
// same prosthesis) are visually linked with a straight connecting line
// through the gap between them — per Monika's reference image, echoing a
// real denture's own connecting bar joining multiple replaced teeth into
// one prosthetic unit. Returns the index of the *left* tooth of every
// adjacent pair that should be connected. Only within this same quadrant's
// own fdis — matches BridgeRow's own scope, which likewise never crosses
// the midline quadrant divider (a separate QuadrantBlock entirely).
function findProsthesisGapIndices(fdis: readonly string[], surfacesByFdi: Record<string, SurfaceMap> | undefined): number[] {
  if (!surfacesByFdi) return [];
  const indices: number[] = [];
  for (let i = 0; i < fdis.length - 1; i++) {
    if (isProsthesisLink(surfacesByFdi[fdis[i]]?.all) && isProsthesisLink(surfacesByFdi[fdis[i + 1]]?.all)) {
      indices.push(i);
    }
  }
  return indices;
}

// The tlorisni-pogled (top-view) squares for one quadrant, on their own —
// split from the tooth-number row so ArchRow can sandwich a PocketDepthRow
// between the two (vestibular reading above tloris, oral reading below, or
// vice versa depending on arch). Same COLUMN_WIDTH/COLUMN_GAP as everything
// else in the chart, so columns line up with the rows above/below.
export function TlorisRow({ fdis, onSelect, selectedFdi, surfacesByFdi, connectToPrev, connectToNext, postByFdi }: TlorisRowProps) {
  const gapIndices = findProsthesisGapIndices(fdis, surfacesByFdi);
  const totalWidth = fdis.length * COLUMN_WIDTH + (fdis.length - 1) * COLUMN_GAP;
  const showPrevHalf = connectToPrev && isProsthesisLink(surfacesByFdi?.[fdis[0]]?.all);
  const showNextHalf = connectToNext && isProsthesisLink(surfacesByFdi?.[fdis[fdis.length - 1]]?.all);

  return (
    <div className="relative flex items-start" style={{ gap: `${COLUMN_GAP}px` }}>
      {(gapIndices.length > 0 || showPrevHalf || showNextHalf) && (
        // Absolutely positioned so it overlays the row without affecting
        // the flex layout below, drawn before the tooth buttons in the DOM
        // so it sits underneath them. In practice the segments never
        // actually run under a tooth's own artwork — each one spans only
        // the gap between two adjacent circles, stopping exactly at each
        // circle's own edge, not through its (transparent) interior.
        // overflow: visible lets the prev/next half-segments below bleed
        // HALF_GAP past this row's own [0, totalWidth] box (into the
        // shared midline gap) without changing the box's own layout size.
        <svg
          width={totalWidth}
          height={TOOTH_SIZE}
          viewBox={`0 0 ${totalWidth} ${TOOTH_SIZE}`}
          style={{ overflow: 'visible' }}
          className="pointer-events-none absolute left-0 top-0"
          aria-hidden="true"
        >
          {gapIndices.map((i) => {
            const x1 = i * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_MARGIN + TOOTH_SIZE;
            const x2 = (i + 1) * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_MARGIN;
            return <line key={i} x1={x1} y1={TOOTH_SIZE / 2} x2={x2} y2={TOOTH_SIZE / 2} stroke={CONNECTOR_COLOR} strokeWidth={1} />;
          })}
          {showPrevHalf && (
            <line x1={-HALF_GAP} y1={TOOTH_SIZE / 2} x2={COLUMN_MARGIN} y2={TOOTH_SIZE / 2} stroke={CONNECTOR_COLOR} strokeWidth={1} />
          )}
          {showNextHalf && (
            <line
              x1={totalWidth - COLUMN_MARGIN}
              y1={TOOTH_SIZE / 2}
              x2={totalWidth + HALF_GAP}
              y2={TOOTH_SIZE / 2}
              stroke={CONNECTOR_COLOR}
              strokeWidth={1}
            />
          )}
        </svg>
      )}
      {fdis.map((fdi) => {
        const meta = TOOTH_META[fdi];
        return (
          <div key={fdi} className="flex flex-none justify-center" style={{ width: `${COLUMN_WIDTH}px` }}>
            <button
              type="button"
              onClick={() => onSelect?.(fdi)}
              className="h-[26px] w-[26px] cursor-pointer rounded-sm outline-offset-2"
              style={fdi === selectedFdi ? { outline: '2px solid var(--tooth-selected, #2e6e62)' } : undefined}
              aria-label={`Tooth ${fdi}`}
            >
              <ToothTopView
                fdi={fdi}
                type={meta.type}
                arch={meta.arch}
                surfaces={surfacesByFdi?.[fdi]}
                hasPost={postByFdi?.[fdi]}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}
