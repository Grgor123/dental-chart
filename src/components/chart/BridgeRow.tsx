import { COLUMN_WIDTH, COLUMN_GAP } from '../../data/toothProfiles';
import { TODO_COLOR, DONE_COLOR, STATUS_COLOR } from '../../data/statusStyles';
import { TOOTH_SIZE } from './TlorisRow';
import type { SealantStage, ToothStatus } from '../../types/dental';

// No text label — this chart is read by dental professionals, who don't
// need "mostiček <fdi>-<fdi>" spelled out; the bracket shape over the
// bridged teeth already says it.
// Row height — the fixed footprint this row reserves in the flex stack
// regardless of what it's showing (bracket, sealant tilde, or nothing).
// Used to be derived from the bracket's own former geometry (a 1px inset
// bar + 3px ticks); now just a flat constant, since the bar no longer
// sits a fixed inset from the tloris-touching edge — see midGapY below.
const ROW_HEIGHT = 4;
// Exported so ArchRow.tsx can give the bottom pocket-depth row the same
// extra spacing this row's own height adds above the tloris squares — see
// the comment at its use site there.
export const BRIDGE_ROW_HEIGHT = ROW_HEIGHT;
// Same grey as STATUS_COLOR (statusStyles.ts) — the bracket was this color
// first, before that grey became the shared "pre-existing/status" marker
// used elsewhere on the chart too.
const BRACKET_COLOR = STATUS_COLOR;
// Bracket stroke — widened from an initial 1px to 2px per Monika's
// explicit request, alongside the sealant tilde's own weight below.
const BRACKET_STROKE_WIDTH = 2;
// Fissure sealant (zalitje fisur) mark — a small tilde, drawn per sealed
// tooth's own column in this same row, per Monika's explicit request that
// it share "the same gap" the bridge bracket already uses rather than get
// its own row. Stroke narrowed from an initial 3px to 2px per Monika's
// explicit follow-up request — matching BRACKET_STROKE_WIDTH exactly.
// Color now depends on the tooth's own SealantStage — TODO_COLOR
// (planned)/DONE_COLOR (done)/STATUS_COLOR (existing, the original and
// still the default look) — see sealantColorFor() below; `sealant` was a
// plain boolean (always this grey) before Monika's explicit request to
// extend the same planned/done/existing pattern to it too.
const SEALANT_STROKE_WIDTH = 2;
// Tilde half-width/amplitude, in this row's own SVG units — doubled from
// an initial 4/1.3 per Monika's explicit follow-up request. At this size
// the tilde no longer fits inside the row's own 4px-tall box, so it's
// centered on the *whole* gap between TlorisRow and the pocket-depth
// numbers instead (see midGapY below) and drawn with the row's own SVG
// set to overflow: visible, the same technique already used for the
// dental-post triangle and abrasion's crown-edge outline.
const SEALANT_HALF_WIDTH = 8;
const SEALANT_AMPLITUDE = 2.6;
// Overlay ("[" -shaped cap, statuses overlay_planned/overlay/
// overlay_existing) — unlike the bracket and sealant tilde, which both
// float at midGapY (the true middle of the full tloris↔pocket-numbers
// gap), the cap wraps the tooth itself: its long bar lies exactly ON
// tickEndY (the edge shared with TlorisRow — "attached to the edge of the
// square with its longer length"), spanning the square's own full
// TOOTH_SIZE width (26px, TlorisRow.tsx) rather than a shorter arbitrary
// width — per Monika's explicit follow-up request that the long bar be
// "the length of the side of a square." Its two short ends continue PAST
// that edge, bleeding into the tooth square's own visual space by
// OVERLAY_WRAP_LEN — "the short bars stick over the corners." That bleed
// needs this row's own overflow: visible (set below, already there for
// the sealant tilde) — the same technique as the dental-post triangle and
// abrasion's crown-edge outline. Colored per tooth via overlayColorFor()
// below (TODO_COLOR/DONE_COLOR/STATUS_COLOR), same planned/done/existing
// pattern as every other three-state marker on the chart.
const OVERLAY_CAP_HALF_WIDTH = TOOTH_SIZE / 2;
const OVERLAY_WRAP_LEN = 3;
// Widened from an initial 2px per Monika's explicit follow-up request.
const OVERLAY_STROKE_WIDTH = 3;

interface BridgeRowProps {
  fdis: readonly string[];
  statuses?: Record<string, ToothStatus>;
  /** Which teeth in this quadrant show the fissure-sealant tilde, and at what stage. */
  sealantByFdi?: Record<string, SealantStage>;
  /**
   * Mirrors the bracket (and the sealant tildes) vertically so this row
   * sits BELOW the tloris row instead of above it — used on the upper arch
   * (see ArchRow.tsx), where the dental post triangle also points outward
   * from the tloris square's own TOP edge (see "Dental post" in
   * CLAUDE.md). A bridge bracket above the squares collides with that post
   * there; flipping this whole row to the bottom edge (which the post
   * never reaches on the upper arch) avoids it entirely. The lower arch
   * keeps the default (unflipped) position — its post points down
   * instead, so above-tloris/post-below already don't collide there.
   */
  flip?: boolean;
}

interface BridgeGroup {
  startIndex: number;
  endIndex: number;
  startFdi: string;
  endFdi: string;
}

// Overlay's own three-state color — TODO_COLOR (still to place), DONE_COLOR
// (just placed), or STATUS_COLOR (already there before this practice
// started tracking it, the same grey the bracket/sealant already use).
function overlayColorFor(status: ToothStatus | undefined): string {
  if (status === 'overlay_planned') return TODO_COLOR;
  if (status === 'overlay') return DONE_COLOR;
  return STATUS_COLOR; // 'overlay_existing'
}

// Same three-state mapping as overlayColorFor, for SealantStage instead of
// ToothStatus — 'existing' (the original, still-default look) reuses the
// same STATUS_COLOR grey the bracket and overlay's own existing state do.
function sealantColorFor(stage: SealantStage): string {
  if (stage === 'planned') return TODO_COLOR;
  if (stage === 'done') return DONE_COLOR;
  return STATUS_COLOR; // 'existing'
}

// A bridge can be anchored on a natural crown or on an implant — a real,
// common clinical case (implant-supported bridge) — so both count as valid
// endpoints. There's no separate `bridge_anchor` status anymore (per
// Monika's explicit request — "this is prevleka where bridge is fixed
// on"): a bridge anchor tooth is just a plain `crown`, structurally and
// visually identical to any other crowned tooth, so detection reads
// `crown` directly instead of a dedicated status. 'implant' teeth keep
// their own fixture rendering untouched (BridgeRow only draws the bracket
// above them); this only changes whether they're recognized as an anchor
// for bracket purposes.
function isBridgeAnchorStatus(status: ToothStatus | undefined): boolean {
  return status === 'crown' || status === 'implant';
}

// Scans one quadrant's FDI order for contiguous runs that start and end on
// an anchor (bridge_anchor or implant) with only 'bridge_pontic' teeth in
// between — the same data ArchRow already reads from surfacesByFdi for
// every other row, no separate "which teeth are bridged together" prop
// needed.
function findBridgeGroups(fdis: readonly string[], statuses: Record<string, ToothStatus> | undefined): BridgeGroup[] {
  if (!statuses) return [];
  const groups: BridgeGroup[] = [];
  let i = 0;
  while (i < fdis.length) {
    if (isBridgeAnchorStatus(statuses[fdis[i]])) {
      let j = i + 1;
      while (j < fdis.length && statuses[fdis[j]] === 'bridge_pontic') j++;
      if (j > i + 1 && j < fdis.length && isBridgeAnchorStatus(statuses[fdis[j]])) {
        groups.push({ startIndex: i, endIndex: j, startFdi: fdis[i], endFdi: fdis[j] });
        i = j;
        continue;
      }
    }
    i++;
  }
  return groups;
}

// One shared row per quadrant, positioned by ArchRow directly against the
// tloris squares — above them by default (between the vestibular/oral
// PocketDepthRow and TlorisRow), or below them when `flip` is set (upper
// arch — see the `flip` prop's own comment): a horizontal bracket over the
// bridged teeth's own columns, with short ticks connecting to the tloris
// row, a small tilde per fissure-sealant tooth, and a "[" -shaped cap per
// overlay tooth (planned/done/existing colors for overlay_planned/
// overlay/overlay_existing), all in the same shared space. Always renders
// at full height even with nothing to show in this quadrant (just empty),
// so the rows on either side stay aligned with the sibling quadrant
// across the arch.
export function BridgeRow({ fdis, statuses, sealantByFdi, flip }: BridgeRowProps) {
  const groups = findBridgeGroups(fdis, statuses);
  const sealedFdis = sealantByFdi ? fdis.filter((fdi) => sealantByFdi[fdi]) : [];
  const overlayFdis = fdis.filter((fdi) => {
    const s = statuses?.[fdi];
    return s === 'overlay_planned' || s === 'overlay' || s === 'overlay_existing';
  });
  const totalWidth = fdis.length * COLUMN_WIDTH + (fdis.length - 1) * COLUMN_GAP;
  // The edge that touches TlorisRow: the row's own bottom (ROW_HEIGHT) by
  // default (TlorisRow sits below), or its top (0) when flipped (TlorisRow
  // sits above instead).
  const tickEndY = flip ? 0 : ROW_HEIGHT;
  // The overlay cap's short ends continue past tickEndY in the same
  // outward direction tickEndY already points (further from midGapY),
  // bleeding into the tooth square's own space rather than stopping at
  // the edge — see OVERLAY_WRAP_LEN above.
  const overlayWrapEndY = tickEndY + (flip ? -1 : 1) * OVERLAY_WRAP_LEN;
  // Both the bracket's own bar AND the sealant tilde center on the FULL
  // visual gap between TlorisRow and the pocket-depth numbers row, not
  // just this row's own 4px box — per Monika's explicit request that the
  // bracket's line match the tilde's own positioning exactly. That full
  // gap is made of two stacked pieces: the plain, unmodified flex gap-1
  // (4px, Tailwind's gap-1) on one side, and this row's own ROW_HEIGHT
  // (4px) on the other, touching TlorisRow — see the -mb-1/-mt-1 comment
  // below for which side is which. Their shared boundary — this row's own
  // edge that does NOT touch TlorisRow — sits exactly at the midpoint of
  // the combined 8px gap (4px in from either end): local y=0 (this row's
  // own top edge) when unflipped, ROW_HEIGHT (its own bottom edge) when
  // flipped — i.e. the opposite edge from tickEndY. The bracket's ticks
  // now span the row's own full height (from tickEndY to midGapY) to
  // reach it, rather than stopping short at a 1px inset the way they used
  // to.
  const midGapY = flip ? ROW_HEIGHT : 0;

  return (
    // Cancels the parent flex stack's own gap-1 (4px) on the side that
    // touches TlorisRow — -mb-1 by default (TlorisRow below), -mt-1 when
    // flipped (TlorisRow above) — so the ticks (which already end exactly
    // at that edge) touch TlorisRow instead of sitting 4px short of it.
    // The *other* side is left as the normal, unmodified gap-1 — that
    // plain 4px, plus this row's own ROW_HEIGHT, is what makes midGapY
    // above land exactly at the true middle of the combined 8px gap.
    <div className={flip ? '-mt-1' : '-mb-1'} style={{ width: `${totalWidth}px`, height: `${ROW_HEIGHT}px` }}>
      {(groups.length > 0 || sealedFdis.length > 0 || overlayFdis.length > 0) && (
        <svg
          width={totalWidth}
          height={ROW_HEIGHT}
          viewBox={`0 0 ${totalWidth} ${ROW_HEIGHT}`}
          role="img"
          aria-label="Mostički, zalitje fisur in overlay"
          style={{ overflow: 'visible' }}
        >
          {groups.map((g) => {
            const startX = g.startIndex * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_WIDTH / 2;
            const endX = g.endIndex * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_WIDTH / 2;
            return (
              <path
                key={`${g.startFdi}-${g.endFdi}`}
                d={`M${startX},${tickEndY} L${startX},${midGapY} L${endX},${midGapY} L${endX},${tickEndY}`}
                fill="none"
                stroke={BRACKET_COLOR}
                strokeWidth={BRACKET_STROKE_WIDTH}
              />
            );
          })}
          {sealedFdis.map((fdi) => {
            const i = fdis.indexOf(fdi);
            const cx = i * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_WIDTH / 2;
            const x0 = cx - SEALANT_HALF_WIDTH;
            const x1 = cx;
            const x2 = cx + SEALANT_HALF_WIDTH;
            return (
              <path
                key={`sealant-${fdi}`}
                d={`M${x0},${midGapY} C${(x0 + x1) / 2},${midGapY - SEALANT_AMPLITUDE} ${(x0 + x1) / 2},${midGapY - SEALANT_AMPLITUDE} ${x1},${midGapY} C${(x1 + x2) / 2},${midGapY + SEALANT_AMPLITUDE} ${(x1 + x2) / 2},${midGapY + SEALANT_AMPLITUDE} ${x2},${midGapY}`}
                fill="none"
                stroke={sealantColorFor(sealantByFdi![fdi])}
                strokeWidth={SEALANT_STROKE_WIDTH}
                strokeLinecap="round"
              />
            );
          })}
          {overlayFdis.map((fdi) => {
            const i = fdis.indexOf(fdi);
            const cx = i * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_WIDTH / 2;
            const x0 = cx - OVERLAY_CAP_HALF_WIDTH;
            const x1 = cx + OVERLAY_CAP_HALF_WIDTH;
            const color = overlayColorFor(statuses?.[fdi]);
            return (
              <path
                key={`overlay-${fdi}`}
                d={`M${x0},${overlayWrapEndY} L${x0},${tickEndY} L${x1},${tickEndY} L${x1},${overlayWrapEndY}`}
                fill="none"
                stroke={color}
                strokeWidth={OVERLAY_STROKE_WIDTH}
                strokeLinecap="square"
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
