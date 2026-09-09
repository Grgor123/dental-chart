import { COLUMN_WIDTH, COLUMN_GAP } from '../../data/toothProfiles';
import { TODO_COLOR, DONE_COLOR, STATUS_COLOR } from '../../data/statusStyles';
import { TOOTH_SIZE } from './TlorisRow';
import type { ToothStatus } from '../../types/dental';

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
// Color depends on the tooth's own sealant status (sealant_planned/
// sealant/sealant_existing, a real ToothStatus now — see sealantColorFor()
// below) — TODO_COLOR (planned)/DONE_COLOR (done)/STATUS_COLOR (existing).
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
// The two quadrants in an ArchRow sit exactly COLUMN_GAP apart (see
// ArchRow.tsx's own gap-equalization note) — same reach TlorisRow.tsx's own
// (unexported) HALF_GAP uses for the prosthesis connector crossing this
// same midline. A bridge bracket that also crosses it (see crossesToPrev/
// crossesToNext below) splits into two HALF_GAP segments the same way,
// meeting exactly at the gap's midpoint with no extra cross-quadrant math.
const HALF_GAP = COLUMN_GAP / 2;

interface BridgeRowProps {
  fdis: readonly string[];
  statuses?: Record<string, ToothStatus>;
  /**
   * Explicit fdi → bridge-group-id map, set only by handleCreateBridge
   * (PatientChart.tsx) when Monika selects an existing anchor together
   * with the teeth it should support and clicks "Člen mostu" — see
   * findBridgeGroups above for why this replaced the earlier purely
   * status-driven inference.
   */
  bridgeGroupByFdi?: Record<string, string>;
  /**
   * Does the bridge group touching this quadrant's own FIRST tooth continue
   * into the PREVIOUS quadrant, across the arch's midline? Same idea as
   * TlorisRow's own `connectToPrev` for the prosthesis connector — see
   * ArchRow.tsx's `bridgeCrossesMidline`. When true, this quadrant's own
   * bracket segment for that group extends past its own first column, into
   * the shared gap, instead of stopping at that tooth's own center.
   */
  crossesToPrev?: boolean;
  /** Same idea, but for a group touching this quadrant's own LAST tooth continuing into the NEXT quadrant. */
  crossesToNext?: boolean;
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
  /** This group's bracket segment in THIS quadrant should extend past startIndex's own column, into the shared gap toward the previous quadrant, rather than stop at that tooth's center — see crossesToPrev above. */
  extendsToPrev: boolean;
  /** Same, past endIndex's own column, toward the next quadrant. */
  extendsToNext: boolean;
}

// Overlay's own three-state color — TODO_COLOR (still to place), DONE_COLOR
// (just placed), or STATUS_COLOR (already there before this practice
// started tracking it, the same grey the bracket/sealant already use).
function overlayColorFor(status: ToothStatus | undefined): string {
  if (status === 'overlay_planned') return TODO_COLOR;
  if (status === 'overlay') return DONE_COLOR;
  return STATUS_COLOR; // 'overlay_existing'
}

// Same three-state mapping as overlayColorFor — sealant is a real
// ToothStatus now (statusStyles.ts), read straight off `statuses` the same
// way overlay already is, not a separate sealantByFdi prop.
function sealantColorFor(status: ToothStatus | undefined): string {
  if (status === 'sealant_planned') return TODO_COLOR;
  if (status === 'sealant') return DONE_COLOR;
  return STATUS_COLOR; // 'sealant_existing'
}

// A bridge can be anchored on a natural crown or on an implant — a real,
// common clinical case (implant-supported bridge) — so both count as valid
// endpoints for a SINGLE anchor. There's no separate `bridge_anchor` status
// anymore (per Monika's explicit request — "this is prevleka where bridge
// is fixed on"): a bridge anchor tooth is just a plain `crown`,
// structurally and visually identical to any other crowned tooth, so
// detection reads `crown` directly instead of a dedicated status.
// 'implant' teeth keep their own fixture rendering untouched (BridgeRow
// only draws the bracket above them); this only changes whether they're
// recognized as an anchor for bracket purposes. When a bridge has TWO
// anchors, though, they must be the SAME type — see the anchorTypesMatch
// check in findBridgeGroups below, and handleCreateBridge's own matching
// check (PatientChart.tsx) at creation time — a crown at one end and an
// implant at the other is a real clinical error, per Monika's explicit
// correction, not just a cosmetic mismatch.
function isAnchorStatus(status: ToothStatus | undefined): boolean {
  return status === 'crown' || status === 'implant';
}

// Which teeth belong to which bridge is now EXPLICIT data
// (`bridgeGroupByFdi`, a fdi → group-id map set by handleCreateBridge in
// PatientChart.tsx), not something this component infers on its own from
// whichever crown/implant/bridge_pontic statuses happen to sit next to each
// other. Two earlier approaches were both tried and reverted:
//
// 1. Draw a bracket over ANY contiguous crown/implant/bridge_pontic run
//    containing at least one pontic, with no requirement that the run be
//    closed off by a real anchor on either end. This meant a single tooth
//    set to `bridge_pontic` right next to an unrelated, pre-existing
//    crown/implant — no intent to bridge the two at all — got silently
//    welded into a phantom bridge with it, and an isolated pontic with no
//    neighbors produced a degenerate zero-width "bracket," a stray
//    vertical tick with nothing to actually span.
// 2. Require the contiguous run to start AND end on a real anchor. This
//    fixed the stray-tick case but not the phantom-bridge one: a tooth
//    that merely happened to sit next to a pre-existing implant still got
//    auto-bracketed to it the moment it became `bridge_pontic`, with no
//    actual decision by Monika to bridge those two teeth together at all
//    (the exact teeth-22/24-next-to-implant-21 case she flagged).
//
// Both were purely inference from final statuses, which can never tell
// "these teeth were deliberately selected together to form one bridge"
// apart from "these statuses just happen to be adjacent." Per Monika's
// explicit request, forming a bridge is now a deliberate act: select an
// existing anchor (crown/implant) together with the teeth it should
// support, then click "Člen mostu" (see handleCreateBridge,
// PatientChart.tsx) — that one action is what populates
// `bridgeGroupByFdi`, and this function only ever draws a bracket for
// teeth recorded there together.
//
// A group's membership is still re-validated against CURRENT statuses on
// every render, though — not blindly trusted — so a tooth whose status
// later changed away from what a bridge needs (an anchor edited to
// something else, a pontic overwritten by a different status via
// ToothDetailPanel) just quietly stops extending the bracket, without
// needing `bridgeGroupByFdi` itself to be actively cleaned up wherever a
// status can change.
//
// **A bridge can cross the arch's own midline** (e.g. 44 all the way to
// 31) — a real clinical case, per Monika's explicit follow-up correcting
// an earlier, too-strict same-quadrant-only rule in handleCreateBridge
// (PatientChart.tsx). That means a single bridge group can have members
// split across TWO quadrants, each with its own BridgeRow instance and its
// own local `fdis` — so validity (does the group have at least one real
// anchor AND at least one pontic?) has to be checked across the group's
// FULL membership, via `bridgeGroupByFdi`'s own keys, not just the members
// visible in THIS quadrant's `fdis`. Otherwise the quadrant that only sees
// this group's pontics (its actual anchor sitting on the other side of the
// midline) would wrongly treat the group as invalid and draw nothing —
// exactly the 44/31 case Monika reported. `statuses` is likewise already
// the WHOLE mouth's map (ArchRow.tsx builds it from every fdi in
// `surfacesByFdi`, not just this quadrant's own eight), so both sides of
// the boundary are visible here regardless of which quadrant they're in.
function findBridgeGroups(
  fdis: readonly string[],
  statuses: Record<string, ToothStatus> | undefined,
  bridgeGroupByFdi: Record<string, string> | undefined,
  crossesToPrev: boolean | undefined,
  crossesToNext: boolean | undefined
): BridgeGroup[] {
  if (!statuses || !bridgeGroupByFdi) return [];
  const idsInOrder: string[] = [];
  for (const fdi of fdis) {
    const id = bridgeGroupByFdi[fdi];
    if (id && !idsInOrder.includes(id)) idsInOrder.push(id);
  }
  const groups: BridgeGroup[] = [];
  for (const id of idsInOrder) {
    let hasAnchor = false;
    let hasPontic = false;
    // Two anchors on the same bridge must be the SAME type — both crown,
    // or both implant, never one of each ("profesionalna napaka," per
    // Monika's explicit clinical correction) — enforced at creation time
    // by handleCreateBridge (PatientChart.tsx), but re-checked live here
    // too, same as hasAnchor/hasPontic above: if an anchor's own status is
    // edited later (via ToothDetailPanel, say) into a mismatch with the
    // bridge's other anchor, the bracket should quietly stop rendering
    // rather than keep showing a now-invalid combination.
    let anchorType: ToothStatus | null = null;
    let anchorTypesMatch = true;
    for (const memberFdi of Object.keys(bridgeGroupByFdi)) {
      if (bridgeGroupByFdi[memberFdi] !== id) continue;
      const status = statuses[memberFdi];
      if (isAnchorStatus(status)) {
        hasAnchor = true;
        if (anchorType === null) anchorType = status!;
        else if (status !== anchorType) anchorTypesMatch = false;
      } else if (status === 'bridge_pontic') {
        hasPontic = true;
      }
      // Any other current status means that particular tooth has
      // effectively left the bridge (edited elsewhere since the group was
      // formed) — it just doesn't contribute to validity, same as before.
    }
    if (!hasAnchor || !hasPontic || !anchorTypesMatch) continue;

    // The group is valid overall — now find only the members actually
    // present in THIS quadrant's own fdis, for this quadrant's own local
    // bracket span.
    const memberIndices: number[] = [];
    fdis.forEach((fdi, index) => {
      if (bridgeGroupByFdi[fdi] !== id) return;
      const status = statuses[fdi];
      if (isAnchorStatus(status) || status === 'bridge_pontic') memberIndices.push(index);
    });
    if (memberIndices.length === 0) continue;
    const startIndex = Math.min(...memberIndices);
    const endIndex = Math.max(...memberIndices);
    // Extend toward the sibling quadrant only if THIS group is actually
    // the one crossing the boundary there (checked via the group id at
    // fdis[0]/fdis[fdis.length-1] — crossesToPrev/crossesToNext alone just
    // says "some bridge crosses here," not necessarily this one).
    const extendsToPrev = !!crossesToPrev && startIndex === 0 && bridgeGroupByFdi[fdis[0]] === id;
    const extendsToNext = !!crossesToNext && endIndex === fdis.length - 1 && bridgeGroupByFdi[fdis[fdis.length - 1]] === id;
    // A single local member with nothing to extend toward is the original
    // degenerate case (an isolated pontic, nothing to span) — skip it, same
    // as the old memberIndices.length < 2 guard did. A single local member
    // that DOES extend toward the sibling quadrant is a real, valid partial
    // segment (this quadrant's own half of a cross-midline bridge), so it's
    // kept.
    if (startIndex === endIndex && !extendsToPrev && !extendsToNext) continue;
    groups.push({ startIndex, endIndex, startFdi: fdis[startIndex], endFdi: fdis[endIndex], extendsToPrev, extendsToNext });
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
export function BridgeRow({ fdis, statuses, bridgeGroupByFdi, crossesToPrev, crossesToNext, flip }: BridgeRowProps) {
  const groups = findBridgeGroups(fdis, statuses, bridgeGroupByFdi, crossesToPrev, crossesToNext);
  const sealedFdis = fdis.filter((fdi) => {
    const s = statuses?.[fdi];
    return s === 'sealant_planned' || s === 'sealant' || s === 'sealant_existing';
  });
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
            // Extended ends reach HALF_GAP past this quadrant's own edge,
            // into the shared gap toward the sibling quadrant, instead of
            // stopping at the real tooth's own column center — see
            // extendsToPrev/extendsToNext (findBridgeGroups above).
            const startX = g.extendsToPrev ? -HALF_GAP : g.startIndex * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_WIDTH / 2;
            const endX = g.extendsToNext ? totalWidth + HALF_GAP : g.endIndex * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_WIDTH / 2;
            // The vertical tick down to TlorisRow only belongs at a REAL
            // tooth's own column — an extended end has no tooth there, just
            // a continuation into the gap, so it skips its own tick (the
            // sibling quadrant's own BridgeRow draws the matching half,
            // meeting this one exactly at the gap's midpoint).
            const startSeg = g.extendsToPrev ? `M${startX},${midGapY}` : `M${startX},${tickEndY} L${startX},${midGapY}`;
            const endSeg = g.extendsToNext ? `L${endX},${midGapY}` : `L${endX},${midGapY} L${endX},${tickEndY}`;
            return (
              <path
                key={`${g.startFdi}-${g.endFdi}`}
                d={`${startSeg} ${endSeg}`}
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
                stroke={sealantColorFor(statuses?.[fdi])}
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
