import type { MouseEvent } from 'react';
import type { ToothType, SurfaceMap, ToothStatus, Surface, EndoStage } from '../../types/dental';
import type { Arch } from '../../data/toothMeta';
import { STATUS_STYLES, TODO_COLOR, DONE_COLOR, STATUS_COLOR, endoColorFor } from '../../data/statusStyles';
import { StatusSymbol } from '../ui/StatusSymbol';

// Same selection-highlight color TlorisRow's own outline already uses for
// selectedFdi, reused here so a selected surface/whole-tooth target reads as
// the same kind of "selected" everywhere on the chart, not a different color.
const SELECTED_COLOR = 'var(--tooth-selected, #2e6e62)';

const BORDER = '#1f1e20';
const BAND_W = 10;
const BAND_H = 8;
const BAND_X = 14 - BAND_W / 2;
const BAND_Y = 14 - BAND_H / 2;
const MID_Y = 14;
// Red used for the abrasion (tooth wear) mark: the collapsed mid-line
// (incisal edge) for anterior teeth, a hollow red-outlined box on the
// occlusal surface for posterior teeth.
const ABRASION_MARK = '#9D1616';
// Prosthesis's own x-cross bounding-box size — sized to keep its corners
// inside the prosthesis circle rather than reaching the square's own
// corners like most other symbols (see the comment at its StatusSymbol
// call below). Every line in this view — outer border, internal dividers,
// and every status's symbol — is 1px wide by default, per Monika's
// explicit request to unify them; the stroke width no longer depends on
// which status's bounding box happens to be passed in (see LINE_WIDTH
// below, passed explicitly rather than left to StatusSymbol's own
// box-relative default formula). The endo-circle (drawn independently of
// this generic symbol block — see endoStage below) is the one deliberate
// exception, at 3px.
const PROSTHESIS_X_SIZE = 16;
const LINE_WIDTH = 1;
// These five also skip the per-surface triangle subdivisions, joining
// bridge_pontic (isBridgeMember, below) in rendering as one flat square
// instead of four individually-filled triangles + an occlusal rectangle —
// per Monika's explicit request to drop their inner divider lines.
// crown/implant/prosthesis_crown/missing/extracted all gain a solid
// whole-square fill (via fillFor(wholeToothStatus!) below) where the
// per-triangle fills previously reached the same color — only their
// divider lines actually disappear. `extraction_planned` deliberately
// stays OUT of this list — a tooth flagged for extraction is still
// present, so it keeps its normal per-surface subdivisions/findings, with
// just a red X drawn over the top (see the symbol block below). A bridge
// anchor is just a plain `crown` (there's no separate `bridge_anchor`
// status anymore — see `isBridgeMemberStatus()` in BridgeRow.tsx), so it
// already gets this same flat treatment via `crown` itself.
// prosthesis_crown is included specifically so it keeps rendering exactly
// like `crown` (its whole point, per statusStyles.ts) now that `crown`
// itself is flat too — any future status meant to look/behave like an
// existing entry here should be added alongside it, not left to silently
// diverge.
const FLAT_INNER_STATUSES: ToothStatus[] = ['crown', 'implant', 'missing', 'extracted', 'prosthesis_crown'];
// Whole-tooth statuses that render with NO per-surface detail at all — every
// FLAT_INNER_STATUSES entry (flat square, no triangles/dots), plus
// bridge_pontic/prosthesis (skip subdivision the same way, via
// isBridgeMember/isProsthesis above) and impacted (ToothTopView returns an
// empty <svg> before any of this runs at all). Exported so
// ToothDetailPanel.tsx can warn when a surface-level edit on one of these
// teeth would have no visible effect on the chart — without this, tapping a
// surface chip under e.g. `implant` silently does nothing, which reads as a
// broken tap rather than "no effect by design." Kept as one predicate here,
// next to FLAT_INNER_STATUSES itself, rather than a second hand-maintained
// list elsewhere that could drift out of sync with this one.
export function hidesSurfaceDetail(status: ToothStatus | undefined): boolean {
  return status === 'bridge_pontic' || status === 'prosthesis' || status === 'impacted' || (!!status && FLAT_INNER_STATUSES.includes(status));
}
// Caries dot: 3px across (radius 1.5), drawn at the center of whichever
// individual surface (zone triangle, or the occlusal rectangle) resolves
// to 'caries'/'caries_treated' — see cariesDotColor() and its call sites
// below. Not tied to LINE_WIDTH: this is a filled marker, not a stroked
// line, so it has its own size independent of the line-width convention.
const CARIES_DOT_RADIUS = 1.5;
// Dental post (zobni zatiček): started as a plain 10px vertical line
// touching the square's own top/bottom edge and extending outward past it
// — swapped for a sharp filled triangle instead, per Monika's explicit
// follow-up, same base-at-the-edge/tip-10-units-out footprint the line
// used, just filled rather than stroked. No dedicated color was specified
// for either version, so it uses BORDER, the same default every other
// line/shape in this view falls back to (see the line convention above).
const DENTAL_POST_LENGTH = 10;
const DENTAL_POST_BASE_WIDTH = 6;
// 'missing' and 'extracted' both fill from ABSENT_SILHOUETTE_COLOR now
// (statusStyles.ts), so their square picks that up automatically via the
// normal fillFor()/FLAT_INNER_STATUSES path below — the only thing still
// special-cased here is dropping the square's own outline entirely (not
// even solid) for both, per Monika's explicit request; see
// isAbsentSilhouette at its use site.

interface ToothTopViewProps {
  fdi: string;
  type: ToothType;
  arch: Arch;
  surfaces?: SurfaceMap;
  /** Dental post (zobni zatiček) — see ToothData.post. */
  hasPost?: boolean;
  /**
   * Endodontic treatment (kanal) — independent of `surfaces`, same reasoning
   * as `hasPost` above: it needs to coexist with whatever ToothStatus the
   * tooth already has (a filling and a completed root canal at once, say),
   * not compete for the single surfaces.all slot. See EndoStage in
   * types/dental.ts.
   */
  endoStage?: EndoStage;
  /**
   * Direct-click targeting for the new selection/paint flow (PatientChart.tsx)
   * — fired per zone (or 'all' for a flat/skip-subdivision/impacted tooth,
   * which has no individual zones to click). fdi isn't passed back here;
   * TlorisRow.tsx already has it in scope and wraps this closure with it.
   */
  onTargetClick?: (target: Surface | 'all', e: MouseEvent) => void;
  /** Whether the given target is currently in the active selection — drives the highlight overlay drawn on top of that zone/square. */
  isTargetSelected?: (target: Surface | 'all') => boolean;
}

type Zone = 'top' | 'right' | 'bottom' | 'left' | 'center';

// Maps the square's geometric zones to anatomical surfaces. The chart is
// always drawn left→right as the dentist views the patient (per CLAUDE.md),
// with upper/lower arches as separate rows and quadrant 1/4 on the left of
// each row, 2/3 on the right, split by a divider at the midline:
//  - mesial always points toward that midline divider, distal away from it
//  - buccal/labial is the "outer" (cheek/lip) surface: drawn at the top for
//    the upper arch, bottom for the lower arch; lingual/palatal is the
//    "inner" surface, on the opposite edge
// Confirmed against Monika's anatomical descriptions — verify this mapping
// against the physical EL 81 chart before relying on it clinically.
function zoneSurfaces(fdi: string, arch: Arch): Record<Exclude<Zone, 'center'>, Surface> {
  const quadrant = Number(fdi[0]);
  const mesialIsRight = quadrant === 1 || quadrant === 4;
  const buccalIsTop = arch === 'upper';
  return {
    top: buccalIsTop ? 'b' : 'l',
    bottom: buccalIsTop ? 'l' : 'b',
    right: mesialIsRight ? 'm' : 'd',
    left: mesialIsRight ? 'd' : 'm',
  };
}

function polygon(points: [number, number][]): string {
  return `M${points.map(([x, y]) => `${x},${y}`).join(' L')} Z`;
}

// Plain vertex average — close enough to "the middle" for these small,
// roughly-convex triangle/trapezoid zones, without needing a proper
// area-weighted polygon centroid.
function centroid(points: [number, number][]): [number, number] {
  const x = points.reduce((sum, [px]) => sum + px, 0) / points.length;
  const y = points.reduce((sum, [, py]) => sum + py, 0) / points.length;
  return [x, y];
}

// Caries/filling family, marked per surface with a small dot, not a fill —
// red while it still needs treatment, blue once just filled, grey for an
// existing restoration already there before this practice started
// tracking the tooth (see TODO_COLOR/DONE_COLOR/STATUS_COLOR in
// statusStyles.ts — the same unified triple every other todo/done/existing
// marker on the chart uses). Returns undefined for every other status, so
// callers can skip drawing a dot entirely.
function cariesDotColor(status: ToothStatus): string | undefined {
  if (status === 'caries') return TODO_COLOR;
  if (status === 'caries_treated') return DONE_COLOR;
  if (status === 'filling') return STATUS_COLOR;
  return undefined;
}

// Anterior teeth's mesial/distal ("side") zones are true triangles — two
// of the three vertices sit on the tooth's own outer corner, one inner
// apex — so the plain vertex-average centroid skews hard toward that
// outer edge (e.g. ~24.3 of 28 units across for the right zone). That's
// close enough to overlap a status that also draws a corner-to-corner
// circle there (endo/endo_planned): the dot ends up against the circle's
// own stroke, barely visible against it. Posterior side zones are
// trapezoids instead (two inner + two outer vertices), whose centroid
// already lands well clear of the circle (~23 of 28 units) — no overlap,
// so no shift needed or applied there; only anterior's side-zone dots are
// nudged inward, toward (14,14) (the tooth's own center, same point every
// corner-to-corner symbol in this file is centered on).
const SIDE_DOT_INWARD_SHIFT = 2;
function dotPositionFor(zone: Exclude<Zone, 'center'>, anterior: boolean, points: [number, number][]): [number, number] {
  const [cx, cy] = centroid(points);
  if (!anterior || (zone !== 'left' && zone !== 'right')) return [cx, cy];
  const dx = 14 - cx;
  const dy = 14 - cy;
  const dist = Math.hypot(dx, dy) || 1;
  return [cx + (dx / dist) * SIDE_DOT_INWARD_SHIFT, cy + (dy / dist) * SIDE_DOT_INWARD_SHIFT];
}

// Exported so ToothDetailPanel.tsx (surface chips) reuses this exact
// resolution rule — surface override, else surfaces.all, else 'healthy' —
// instead of reimplementing it. The old `Surface | 'o'` parameter type was
// redundant: 'o' is already a member of Surface via PostSurface.
export function statusFor(surfaces: SurfaceMap | undefined, surface: Surface): ToothStatus {
  return (surfaces?.[surface] ?? surfaces?.all ?? 'healthy') as ToothStatus;
}

function fillFor(status: ToothStatus): string {
  const fill = STATUS_STYLES[status].fill;
  return fill === 'none' ? 'transparent' : fill;
}

// Abrasion (tooth wear) never fills a full surface region — it's drawn as
// its own dedicated red mark (bowtie / hollow box, see ABRASION_MARK) on
// top of everything else instead. So every region — outer zones and the
// posterior occlusal rectangle alike — stays blank whenever its resolved
// status is 'abrasion', regardless of tooth type.
function regionFillFor(status: ToothStatus): string {
  return status === 'abrasion' ? 'transparent' : fillFor(status);
}

// FDI square: posterior teeth get 4 outer regions + a center rectangle
// (okluzalna); anterior teeth get 4 regions meeting at a short collapsed
// line instead of a point (no okluzalna) — geometry traced against
// dental chart template.jpg.
export function ToothTopView({ fdi, type, arch, surfaces, hasPost, endoStage, onTargetClick, isTargetSelected }: ToothTopViewProps) {
  const anterior = type === 'ant';
  const zones = zoneSurfaces(fdi, arch);

  const wholeToothStatus = surfaces?.all;

  // Impacted: the tooth hasn't erupted, so there's nothing to show from
  // directly above it — no square, no fill, no border, no symbol, not even
  // the dental-post triangle. Its whole rendering lives in the side view
  // instead (PerioGraphRow), where it's drawn submerged below the gumline
  // and clipped against the perio ruler's own last horizontal line — see
  // CLAUDE.md's "Impacted tooth" section. The 28×28 viewBox is kept (not an
  // empty fragment) purely so this still behaves like every other tooth's
  // <svg> as a layout element inside TlorisRow's fixed-size button. Still
  // targetable as a whole (onTargetClick('all', …)) even though nothing is
  // drawn — consistent with hidesSurfaceDetail() treating impacted as
  // whole-tooth-only.
  if (wholeToothStatus === 'impacted') {
    return (
      <svg
        viewBox="0 0 28 28"
        role="img"
        aria-label={`Top view ${fdi}`}
        onClick={(e) => onTargetClick?.('all', e)}
        style={{ pointerEvents: 'all', cursor: onTargetClick ? 'pointer' : undefined }}
      />
    );
  }

  const wholeStyle = wholeToothStatus ? STATUS_STYLES[wholeToothStatus] : undefined;
  // 'missing' (never present) and 'extracted' (removed) both skip the
  // square's own outline entirely — per Monika's explicit request, "just
  // keep the filling" — rather than the normal dark border every other
  // status gets. Neither sets STATUS_STYLES.borderDash/.border anymore, so
  // outerDash/outerStroke would already resolve to "no dash, default dark
  // border" on their own; this flag is what additionally drops the border
  // itself down to stroke="none" at the <rect> below.
  const isAbsentSilhouette = wholeToothStatus === 'missing' || wholeToothStatus === 'extracted';
  const outerStroke = wholeStyle?.border ?? BORDER;
  const outerDash = wholeStyle?.borderDash ? '2 1.5' : undefined;

  const lx = BAND_X;
  const rx = BAND_X + BAND_W;

  const zonePolygons: Record<Exclude<Zone, 'center'>, [number, number][]> = anterior
    ? {
        top: [[1, 1], [27, 1], [rx, MID_Y], [lx, MID_Y]],
        right: [[27, 1], [27, 27], [rx, MID_Y]],
        bottom: [[27, 27], [1, 27], [lx, MID_Y], [rx, MID_Y]],
        left: [[1, 27], [1, 1], [lx, MID_Y]],
      }
    : {
        top: [[1, 1], [27, 1], [rx, BAND_Y], [lx, BAND_Y]],
        right: [[27, 1], [27, 27], [rx, BAND_Y + BAND_H], [rx, BAND_Y]],
        bottom: [[27, 27], [1, 27], [lx, BAND_Y + BAND_H], [rx, BAND_Y + BAND_H]],
        left: [[1, 27], [1, 1], [lx, BAND_Y], [lx, BAND_Y + BAND_H]],
      };

  const occlusalStatus = !anterior ? statusFor(surfaces, 'o') : undefined;
  const anteriorAbrasion = anterior && wholeToothStatus === 'abrasion';
  const posteriorAbrasion = occlusalStatus === 'abrasion';
  // A bridge pontic is one prosthetic unit, not a natural tooth with its
  // own per-surface findings — so it skips the surface subdivisions
  // entirely (no triangles, no occlusal rectangle, no divider lines) and
  // renders as a single flat square instead, matching Monika's reference
  // chart. The whole-tooth color, which would otherwise come from the
  // (now-skipped) zone fills, goes on the outer square directly. (A bridge
  // *anchor* used to be its own `bridge_anchor` status here too, but it's
  // just a plain `crown` now — already flat via FLAT_INNER_STATUSES below,
  // so it doesn't need to be listed in this flag at all.)
  const isBridgeMember = wholeToothStatus === 'bridge_pontic';
  // A prosthesis (removable denture) tooth isn't a natural tooth present in
  // the mouth at all, so — like a bridge member — it skips per-surface
  // subdivision entirely. Unlike every other status it also swaps the outer
  // square for a circle of the same footprint (same bounding box the square
  // occupies), per Monika's explicit request, so it reads as visually
  // distinct from both a real tooth and from missing/extracted (which keep
  // the square). The x-cross itself comes for free from the generic
  // wholeStyle.symbol block below — STATUS_STYLES.prosthesis already sets
  // symbol: 'x-cross', same as missing/extracted.
  const isProsthesis = wholeToothStatus === 'prosthesis';
  const isPontic = wholeToothStatus === 'bridge_pontic';
  // Extraction pair — like abrasion/endo, its X-cross is drawn at 3px, the
  // same deliberate exception to this view's usual 1px line weight, per
  // Monika's explicit request.
  const isExtractionPair = wholeToothStatus === 'extraction_planned' || wholeToothStatus === 'extracted';
  const isFlatInner = !!wholeToothStatus && FLAT_INNER_STATUSES.includes(wholeToothStatus);
  const skipSubdivision = isBridgeMember || isProsthesis || isFlatInner;

  return (
    // overflow: visible so the dental-post line (below) can bleed past the
    // square's own edge into the surrounding gap — every other element in
    // this file stays within the 0–28 viewBox regardless, so this has no
    // effect on anything but the post.
    <svg viewBox="0 0 28 28" role="img" aria-label={`Top view ${fdi}`} style={{ overflow: 'visible' }}>
      {!skipSubdivision && (
        <>
          {(['top', 'right', 'bottom', 'left'] as const).map((zone) => (
            <path
              key={zone}
              d={polygon(zonePolygons[zone])}
              fill={regionFillFor(statusFor(surfaces, zones[zone]))}
              stroke="none"
              // pointerEvents: 'all' is needed because a transparent/'none'
              // fill doesn't receive pointer events by default in SVG (the
              // default 'visiblePainted' only counts actually-painted
              // areas) — without this, clicking a healthy (unfilled) zone
              // would silently miss.
              style={{ pointerEvents: 'all', cursor: onTargetClick ? 'pointer' : undefined }}
              onClick={(e) => onTargetClick?.(zones[zone], e)}
            />
          ))}
          {(['top', 'right', 'bottom', 'left'] as const).map(
            (zone) =>
              isTargetSelected?.(zones[zone]) && (
                <path
                  key={`sel-${zone}`}
                  d={polygon(zonePolygons[zone])}
                  fill={SELECTED_COLOR}
                  fillOpacity={0.28}
                  stroke="none"
                  style={{ pointerEvents: 'none' }}
                />
              ),
          )}
          {!anterior && (
            <>
              <rect
                x={BAND_X}
                y={BAND_Y}
                width={BAND_W}
                height={BAND_H}
                fill={regionFillFor(occlusalStatus!)}
                stroke="none"
                style={{ pointerEvents: 'all', cursor: onTargetClick ? 'pointer' : undefined }}
                onClick={(e) => onTargetClick?.('o', e)}
              />
              {isTargetSelected?.('o') && (
                <rect
                  x={BAND_X}
                  y={BAND_Y}
                  width={BAND_W}
                  height={BAND_H}
                  fill={SELECTED_COLOR}
                  fillOpacity={0.28}
                  stroke="none"
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </>
          )}
        </>
      )}

      {/* skipSubdivision teeth (bridge_pontic/prosthesis/FLAT_INNER_STATUSES)
          have no zone paths to click individually — the whole shape below
          is the only target, so it gets onTargetClick('all', …) directly.
          pointerEvents: 'all' is needed unconditionally here too: several of
          these statuses (bridge_pontic, and the prosthesis circle always)
          fill 'none'/'transparent', which wouldn't otherwise register a
          click across the shape's interior, only its stroke. Non-flat
          (normal, subdivided) teeth don't get a click handler here at all —
          their zone paths above already cover the whole square between
          them, and the outer border/circle is just decoration. */}
      {isProsthesis ? (
        <circle
          cx={14}
          cy={14}
          r={13}
          fill="none"
          stroke={outerStroke}
          strokeWidth={LINE_WIDTH}
          strokeDasharray={outerDash}
          style={skipSubdivision ? { pointerEvents: 'all', cursor: onTargetClick ? 'pointer' : undefined } : undefined}
          onClick={skipSubdivision ? (e) => onTargetClick?.('all', e) : undefined}
        />
      ) : (
        <rect
          x={1}
          y={1}
          width={26}
          height={26}
          fill={isBridgeMember || isFlatInner ? fillFor(wholeToothStatus!) : 'none'}
          stroke={isAbsentSilhouette ? 'none' : outerStroke}
          strokeWidth={LINE_WIDTH}
          strokeDasharray={outerDash}
          style={skipSubdivision ? { pointerEvents: 'all', cursor: onTargetClick ? 'pointer' : undefined } : undefined}
          onClick={skipSubdivision ? (e) => onTargetClick?.('all', e) : undefined}
        />
      )}
      {skipSubdivision && isTargetSelected?.('all') && (
        isProsthesis ? (
          <circle cx={14} cy={14} r={13} fill={SELECTED_COLOR} fillOpacity={0.28} stroke="none" style={{ pointerEvents: 'none' }} />
        ) : (
          <rect x={1} y={1} width={26} height={26} fill={SELECTED_COLOR} fillOpacity={0.28} stroke="none" style={{ pointerEvents: 'none' }} />
        )
      )}
      {!skipSubdivision &&
        (anterior ? (
          <>
            <path
              d={`M1,1 L${lx},${MID_Y} M27,1 L${rx},${MID_Y} M27,27 L${rx},${MID_Y} M1,27 L${lx},${MID_Y}`}
              stroke={BORDER}
              strokeWidth={LINE_WIDTH}
              fill="none"
            />
            {/* Collapsed mid-line stands in for the incisal edge — turns red
                for abrasion (tooth wear) instead of the usual dark divider. */}
            <line
              x1={lx}
              y1={MID_Y}
              x2={rx}
              y2={MID_Y}
              stroke={anteriorAbrasion ? ABRASION_MARK : BORDER}
              strokeWidth={anteriorAbrasion ? 3 : LINE_WIDTH}
            />
          </>
        ) : (
          <>
            <path
              d={`M1,1 L${BAND_X},${BAND_Y} M27,1 L${BAND_X + BAND_W},${BAND_Y} M27,27 L${BAND_X + BAND_W},${BAND_Y + BAND_H} M1,27 L${BAND_X},${BAND_Y + BAND_H}`}
              stroke={BORDER}
              strokeWidth={LINE_WIDTH}
              fill="none"
            />
            <rect
              x={BAND_X}
              y={BAND_Y}
              width={BAND_W}
              height={BAND_H}
              fill="none"
              stroke={posteriorAbrasion ? ABRASION_MARK : BORDER}
              strokeWidth={posteriorAbrasion ? 3 : LINE_WIDTH}
            />
          </>
        ))}
      {/* Caries dots — drawn per surface (unlike every other symbol in this
          file, which is whole-tooth only), one per zone whose own resolved
          status is caries/caries_treated, at that zone's own center (side
          zones nudged inward — see dotPositionFor). Drawn after the
          divider lines so a dot sitting near a triangle edge isn't
          partially covered by it. */}
      {!skipSubdivision &&
        (['top', 'right', 'bottom', 'left'] as const).map((zone) => {
          const color = cariesDotColor(statusFor(surfaces, zones[zone]));
          if (!color) return null;
          const [cx, cy] = dotPositionFor(zone, anterior, zonePolygons[zone]);
          return <circle key={`caries-${zone}`} cx={cx} cy={cy} r={CARIES_DOT_RADIUS} fill={color} stroke="none" />;
        })}
      {!skipSubdivision &&
        !anterior &&
        (() => {
          const color = cariesDotColor(occlusalStatus!);
          if (!color) return null;
          return <circle cx={BAND_X + BAND_W / 2} cy={BAND_Y + BAND_H / 2} r={CARIES_DOT_RADIUS} fill={color} stroke="none" />;
        })()}
      {wholeStyle?.symbol && (
        // The bounding box (position/size) still differs per status:
        //  - prosthesis: a centered 16×16 box (PROSTHESIS_X_SIZE) — keeps
        //    the cross's corners (radius ~11.3) inside the prosthesis
        //    circle (radius 13); the generic x=3,y=3,w=22,h=22 box below
        //    would poke past it (corners at radius ~15.6).
        //  - bridge_pontic: reaches the square's own corners exactly —
        //    x=1,y=1 matching the outer <rect>'s own corner, w=h=26
        //    matching its own size.
        //  - everything else (extracted, extraction_planned): the original
        //    inset box. `missing` has no symbol at all anymore
        //    (STATUS_STYLES.missing sets none), so it never reaches this
        //    block in the first place — per Monika's explicit request, the
        //    tloris square no longer crosses out a missing tooth, matching
        //    the side view's own light-silhouette-only treatment.
        // Stroke width is LINE_WIDTH (1px) for every status except the
        // extraction pair, which uses 3px — the same weight as abrasion's
        // own mark (and the endo-circle's own, drawn separately below), per
        // Monika's explicit request — rather than StatusSymbol's own
        // default (box-size-relative) formula, which is exactly why these
        // differently-sized boxes used to produce differently-thick crosses
        // before that was unified.
        <StatusSymbol
          symbol={wholeStyle.symbol}
          x={isProsthesis ? 6 : isPontic ? 1 : 3}
          y={isProsthesis ? 6 : isPontic ? 1 : 3}
          width={isProsthesis ? PROSTHESIS_X_SIZE : isPontic ? 26 : 22}
          height={isProsthesis ? PROSTHESIS_X_SIZE : isPontic ? 26 : 22}
          strokeWidth={isExtractionPair ? 3 : LINE_WIDTH}
          color={wholeStyle.symbolColor ?? wholeStyle.border ?? '#D4537E'}
        />
      )}
      {/* Endodontic treatment (kanal) — independent of `surfaces`/
          `wholeStyle` (see endoStage above), so unlike every other symbol
          in this file it's drawn in its own unconditional block rather
          than through the generic wholeStyle.symbol dispatch above — it
          needs to show up regardless of whatever real ToothStatus the
          tooth also has (a filling, a crown, plain caries...), not just
          when surfaces.all happens to be unset. Same circle-in-square
          geometry the old endo/endo_planned/endo_existing statuses used —
          touching the square's own outer corners (x=1,y=1,w=h=26 →
          StatusSymbol's endo-circle branch inscribes r=13 centered at
          (14,14), the square's own center) at the same 3px stroke weight —
          just colored via endoColorFor(endoStage) instead of a
          STATUS_STYLES entry. */}
      {endoStage && (
        <StatusSymbol symbol="endo-circle" x={1} y={1} width={26} height={26} strokeWidth={3} color={endoColorFor(endoStage)} />
      )}
      {/* Dental post — drawn last so it stays visible over any fill/symbol
          underneath. A sharp hollow (outline-only) triangle: its base sits
          right on the square's own outer edge — the bottom (y=27) on the
          lower arch, the top (y=1) on the upper arch — and its tip points
          10 units *outward* past it, into the surrounding gap (relies on
          the svg's own overflow: visible, above, plus none of its
          ancestors in TlorisRow.tsx clipping either). A solid-filled
          version was tried first and reverted per Monika's explicit
          request for a hollow interior instead — same footprint either
          way, just stroke instead of fill. */}
      {hasPost && (
        <polygon
          points={
            arch === 'upper'
              ? `${14 - DENTAL_POST_BASE_WIDTH / 2},1 ${14 + DENTAL_POST_BASE_WIDTH / 2},1 14,${1 - DENTAL_POST_LENGTH}`
              : `${14 - DENTAL_POST_BASE_WIDTH / 2},27 ${14 + DENTAL_POST_BASE_WIDTH / 2},27 14,${27 + DENTAL_POST_LENGTH}`
          }
          fill="none"
          stroke={BORDER}
          strokeWidth={LINE_WIDTH}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
