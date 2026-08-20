import type { Arch } from '../../data/toothMeta';
import { COLUMN_WIDTH, COLUMN_GAP } from '../../data/toothProfiles';
import type { SurfaceMap, PocketDepths, GumMargin, BleedingPoints, ToothStatus, SealantStage } from '../../types/dental';
import { PerioGraphRow } from './PerioGraphRow';
import { PocketDepthRow } from './PocketDepthRow';
import { BridgeRow, BRIDGE_ROW_HEIGHT } from './BridgeRow';
import { TlorisRow, isProsthesisLink } from './TlorisRow';
import { NumberRow } from './NumberRow';

interface ArchRowProps {
  label: string;
  arch: Arch;
  leftQuadrant: readonly string[];
  rightQuadrant: readonly string[];
  onSelect?: (fdi: string) => void;
  selectedFdi?: string;
  surfacesByFdi?: Record<string, SurfaceMap>;
  pocketsBuccal?: Record<string, PocketDepths>;
  pocketsLingual?: Record<string, PocketDepths>;
  gumMargin?: Record<string, GumMargin>;
  bleedingBuccal?: Record<string, BleedingPoints>;
  bleedingLingual?: Record<string, BleedingPoints>;
  postByFdi?: Record<string, boolean>;
  /** Which teeth show the fissure-sealant tilde in the bridge row. */
  sealantByFdi?: Record<string, SealantStage>;
}

export function ArchRow({
  label,
  arch,
  leftQuadrant,
  rightQuadrant,
  onSelect,
  selectedFdi,
  surfacesByFdi,
  pocketsBuccal,
  pocketsLingual,
  gumMargin,
  bleedingBuccal,
  bleedingLingual,
  postByFdi,
  sealantByFdi,
}: ArchRowProps) {
  const statuses: Record<string, ToothStatus> = {};
  if (surfacesByFdi) {
    for (const [fdi, surfaces] of Object.entries(surfacesByFdi)) {
      if (surfaces.all) statuses[fdi] = surfaces.all;
    }
  }

  // The two quadrants meet at the arch's own midline — a prosthesis run can
  // cross it too (e.g. 41-31, or a prosthesis_crown tooth like 42 chained
  // next to it), so check the two boundary teeth the same way TlorisRow
  // already checks any other adjacent pair (isProsthesisLink — shared so
  // the two never drift apart on which statuses count).
  const lastLeftFdi = leftQuadrant[leftQuadrant.length - 1];
  const firstRightFdi = rightQuadrant[0];
  const crossesMidline = isProsthesisLink(statuses[lastLeftFdi]) && isProsthesisLink(statuses[firstRightFdi]);

  // Pixel offset of the divider from the row's own left edge, computed from
  // the same COLUMN_WIDTH/COLUMN_GAP constants every row's own width is
  // built from — deliberately *not* CSS `left-1/2`. Percentage centering
  // relies on the flex row's own auto content width exactly matching
  // leftQuadrant width + gap + rightQuadrant width, which broke in
  // practice (the divider landed inside the right quadrant, around tooth
  // 27/37) — likely some sibling row not sizing exactly as expected. This
  // pixel formula sidesteps that entirely: it's the same "quadrant width,
  // then half the shared gap" math TlorisRow's own HALF_GAP connector
  // already uses for the identical boundary, so the divider and the
  // prosthesis connector's meeting point are now guaranteed to agree.
  const leftQuadrantWidth = leftQuadrant.length * COLUMN_WIDTH + (leftQuadrant.length - 1) * COLUMN_GAP;
  const dividerLeftPx = leftQuadrantWidth + COLUMN_GAP / 2;

  return (
    <div>
      <p className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--muted,#6f7c79)]">
        {label}
      </p>
      {/* The divider is positioned via an explicit pixel offset
          (dividerLeftPx, computed above) rather than as a third flex item —
          keeps the gap between quadrants the same COLUMN_GAP width as every
          other tooth-to-tooth gap, instead of the wider hand-added margin
          an earlier version used around an in-flow divider. Also
          deliberately not CSS percentage centering (`left-1/2`) — that
          relies on the row's own auto content width exactly matching
          leftWidth + gap + rightWidth, which in practice put the divider
          inside the right quadrant instead of between the two; the pixel
          formula avoids that failure mode entirely. */}
      <div className="relative flex min-w-max items-start" style={{ gap: `${COLUMN_GAP}px` }}>
        <QuadrantBlock
          fdis={leftQuadrant}
          arch={arch}
          onSelect={onSelect}
          selectedFdi={selectedFdi}
          surfacesByFdi={surfacesByFdi}
          pocketsBuccal={pocketsBuccal}
          pocketsLingual={pocketsLingual}
          gumMargin={gumMargin}
          bleedingBuccal={bleedingBuccal}
          bleedingLingual={bleedingLingual}
          statuses={statuses}
          connectToNext={crossesMidline}
          postByFdi={postByFdi}
          sealantByFdi={sealantByFdi}
        />
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-[var(--ink,#1c2624)] opacity-60"
          style={{ left: `${dividerLeftPx}px` }}
        />
        <QuadrantBlock
          fdis={rightQuadrant}
          arch={arch}
          onSelect={onSelect}
          selectedFdi={selectedFdi}
          surfacesByFdi={surfacesByFdi}
          pocketsBuccal={pocketsBuccal}
          pocketsLingual={pocketsLingual}
          gumMargin={gumMargin}
          bleedingBuccal={bleedingBuccal}
          bleedingLingual={bleedingLingual}
          statuses={statuses}
          connectToPrev={crossesMidline}
          postByFdi={postByFdi}
          sealantByFdi={sealantByFdi}
        />
      </div>
    </div>
  );
}

interface QuadrantBlockProps {
  fdis: readonly string[];
  arch: Arch;
  onSelect?: (fdi: string) => void;
  selectedFdi?: string;
  surfacesByFdi?: Record<string, SurfaceMap>;
  pocketsBuccal?: Record<string, PocketDepths>;
  pocketsLingual?: Record<string, PocketDepths>;
  gumMargin?: Record<string, GumMargin>;
  bleedingBuccal?: Record<string, BleedingPoints>;
  bleedingLingual?: Record<string, BleedingPoints>;
  statuses: Record<string, ToothStatus>;
  connectToPrev?: boolean;
  connectToNext?: boolean;
  postByFdi?: Record<string, boolean>;
  sealantByFdi?: Record<string, SealantStage>;
}

// Both views for a whole quadrant. Per Monika's request, pocket depth needs
// both the vestibular (buccal) and oral (lingual) surface visible at once,
// so a PD row sits directly above the tloris squares and another directly
// below — same top=buccal/bottom=lingual (upper arch) or top=lingual/
// bottom=buccal (lower arch) convention already used for the tloris
// squares' own surface zones (see ToothTopView's zoneSurfaces), so a
// reading's position here means the same thing it means there.
//
// Stack order differs by arch: upper keeps the silhouette/gumline graph at
// the very top (roots pointing up, away from the tloris block) with the
// tooth number innermost, closest to the tloris squares. Lower puts the
// number outermost instead — below the tooth artwork — per feedback that
// it reads better there than sandwiched above the roots.
function QuadrantBlock({
  fdis,
  arch,
  onSelect,
  selectedFdi,
  surfacesByFdi,
  pocketsBuccal,
  pocketsLingual,
  gumMargin,
  bleedingBuccal,
  bleedingLingual,
  statuses,
  connectToPrev,
  connectToNext,
  postByFdi,
  sealantByFdi,
}: QuadrantBlockProps) {
  const topPockets = arch === 'upper' ? pocketsBuccal : pocketsLingual;
  const bottomPockets = arch === 'upper' ? pocketsLingual : pocketsBuccal;
  const topBleeding = arch === 'upper' ? bleedingBuccal : bleedingLingual;
  const bottomBleeding = arch === 'upper' ? bleedingLingual : bleedingBuccal;

  const graph = <PerioGraphRow fdis={fdis} arch={arch} gumMargin={gumMargin} statuses={statuses} />;
  const tloris = (
    <TlorisRow
      fdis={fdis}
      onSelect={onSelect}
      selectedFdi={selectedFdi}
      surfacesByFdi={surfacesByFdi}
      connectToPrev={connectToPrev}
      connectToNext={connectToNext}
      postByFdi={postByFdi}
    />
  );
  // The dental post triangle points outward from the tloris square's own
  // top edge on the upper arch, bottom edge on the lower arch (see "Dental
  // post" in CLAUDE.md). BridgeRow's bracket normally sits above TlorisRow
  // (`flip` unset) — fine on the lower arch, where the post points the
  // opposite way (down) — but on the upper arch that puts the bracket on
  // the exact same edge the post reaches into, so the two collide. `flip`
  // moves the bracket (and the fissure-sealant tildes drawn in the same
  // row — see BridgeRow.tsx) to the tloris row's bottom edge instead for
  // the upper arch, the one edge its own post never touches. This also
  // happens to be exactly the arrangement Monika asked for when sealant
  // was added — above tloris on the lower arch, below it on the upper —
  // so sealant needed no positioning logic of its own beyond sharing this
  // same `flip`.
  const bridge = <BridgeRow fdis={fdis} statuses={statuses} sealantByFdi={sealantByFdi} flip={arch === 'upper'} />;
  // Whichever pocket-depth row ends up on the *same* side as BridgeRow gets
  // BRIDGE_ROW_HEIGHT of extra margin, pushing it out to match the natural
  // gap on the side without a bridge row — BridgeRow always renders at
  // full height even when empty (see its own comment), so without this the
  // gap through it reads as wider than the plain, unmodified gap-1 on the
  // other side. This also keeps the post's own outward reach clear of the
  // pocket-depth numbers on whichever side it points toward (the original
  // reason this spacer existed, before BridgeRow could flip sides) — per
  // Monika's explicit request, extended to the upper arch below once
  // flipping the bracket there moved it onto the post's own side.
  const pdAndTloris =
    arch === 'upper' ? (
      <>
        <div style={{ marginBottom: `${BRIDGE_ROW_HEIGHT}px` }}>
          <PocketDepthRow fdis={fdis} pockets={topPockets} bleeding={topBleeding} />
        </div>
        {tloris}
        {bridge}
        <PocketDepthRow fdis={fdis} pockets={bottomPockets} bleeding={bottomBleeding} />
      </>
    ) : (
      <>
        <PocketDepthRow fdis={fdis} pockets={topPockets} bleeding={topBleeding} />
        {bridge}
        {tloris}
        <div style={{ marginTop: `${BRIDGE_ROW_HEIGHT}px` }}>
          <PocketDepthRow fdis={fdis} pockets={bottomPockets} bleeding={bottomBleeding} />
        </div>
      </>
    );
  const number = <NumberRow fdis={fdis} />;

  return (
    <div className="flex flex-col items-start gap-1">
      {arch === 'upper' ? (
        <>
          {graph}
          {pdAndTloris}
          {number}
        </>
      ) : (
        <>
          {pdAndTloris}
          {graph}
          {number}
        </>
      )}
    </div>
  );
}
