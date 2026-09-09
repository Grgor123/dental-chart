import { useId } from 'react';
import type { Arch } from '../../data/toothMeta';
import { TOOTH_PROFILES, COLUMN_WIDTH, COLUMN_GAP, PX_PER_MM } from '../../data/toothProfiles';
import type { GumMargin, ToothStatus } from '../../types/dental';
import { ToothSideViewContent } from './ToothSideView';
import { POINT_X_FRACTIONS, samePerioPoint, type PerioPoint } from './perioStyle';

const RULER_STEP_MM = 2;
// Room reserved beyond the deepest root in the row for the REC (gum-margin)
// number row, past every root tip so it never sits on top of the tooth
// artwork itself. Pocket depth used to live out here too, but per Monika's
// feedback it needed to show both the vestibular and oral surface at once,
// which reads far better right next to the tooth number — see
// PocketDepthRow, composed into the column stack by ArchRow instead.
const REC_ROW_INSET = 8;
const ROOT_LABEL_MARGIN_PX = REC_ROW_INSET + 6;
const CROWN_LABEL_MARGIN_PX = 6;

const REC_LABEL_COLOR = '#4C7093';
const REC_HIT_RADIUS = 7;
const SELECTED_COLOR = 'var(--tooth-selected, #2e6e62)';
// Faint placeholder for an interactive-but-not-yet-entered REC point — same
// reasoning as PocketDepthRow's own PLACEHOLDER_COLOR: the hit circle is
// otherwise fully invisible, so without this there's nothing to see where a
// click would start entry. Only shown when interactive (PatientChart.tsx);
// the read-only StatusShowcase.tsx chart is unaffected.
const REC_PLACEHOLDER_RADIUS = 2.5;
const PLACEHOLDER_COLOR = '#ccd6d4';

type GumPoint = Extract<PerioPoint, { kind: 'gum' }>;

interface PerioGraphRowProps {
  fdis: readonly string[];
  arch: Arch;
  /** Gingival margin per tooth (buccal surface), [mesial, mid, distal] mm. Defaults to 0 (at CEJ) for any tooth not given. */
  gumMargin?: Record<string, GumMargin>;
  statuses?: Record<string, ToothStatus>;
  /** Click-to-focus/type-a-number entry (PatientChart.tsx) — see PerioPoint. Optional: StatusShowcase.tsx's read-only chart simply never passes these, so nothing there becomes interactive. */
  onPointClick?: (point: GumPoint) => void;
  focusedPoint?: PerioPoint | null;
}

// Tooth silhouettes + continuous gum-margin line, modeled on Curve Dental's
// periodontal chart: every tooth's CEJ is aligned to one flat baseline
// across the whole quadrant, with a shared mm ruler behind it and the
// actual gum margin traced as a line through 3 points per tooth, labeled
// (REC, plain magnitude) just past the root tips. Width/x-positions use the
// exact same COLUMN_WIDTH/COLUMN_GAP constants ArchRow uses everywhere else,
// so this lines up with the rows above/below it.
export function PerioGraphRow({ fdis, arch, gumMargin, statuses, onPointClick, focusedPoint }: PerioGraphRowProps) {
  const profiles = fdis.map((fdi) => TOOTH_PROFILES[fdi]);
  const maxRootMm = Math.max(...profiles.map((p) => p.rootLengthMm));
  const maxCrownMm = Math.max(...profiles.map((p) => p.crownLengthMm));

  const rootZonePx = maxRootMm * PX_PER_MM + ROOT_LABEL_MARGIN_PX;
  const crownZonePx = maxCrownMm * PX_PER_MM + CROWN_LABEL_MARGIN_PX;
  const svgHeight = rootZonePx + crownZonePx;
  const cejY = arch === 'upper' ? rootZonePx : crownZonePx;
  const totalWidth = fdis.length * COLUMN_WIDTH + (fdis.length - 1) * COLUMN_GAP;
  // Toward the crown is +y for upper (crown hangs below CEJ) and -y for
  // lower (crown sits above CEJ) — see ToothSideViewContent's own
  // arch-aware crownTop/crownHeight for the same convention.
  const coronalSign = arch === 'upper' ? 1 : -1;
  // REC row sits past the root tips: near y=0 for upper (roots point up),
  // near y=svgHeight for lower (roots point down) — "where the roots end."
  const recRowY = arch === 'upper' ? REC_ROW_INSET : svgHeight - REC_ROW_INSET;

  const rulerUpMm = arch === 'upper' ? maxRootMm : maxCrownMm;
  const rulerDownMm = arch === 'upper' ? maxCrownMm : maxRootMm;
  const ticks: number[] = [0];
  for (let mm = RULER_STEP_MM; mm <= rulerUpMm; mm += RULER_STEP_MM) ticks.push(mm);
  for (let mm = RULER_STEP_MM; mm <= rulerDownMm; mm += RULER_STEP_MM) ticks.push(-mm);

  // An impacted tooth is unerupted — per Monika's explicit request, its
  // whole silhouette (crown+root together) is drawn shifted one full
  // crown-length further AWAY from the crown direction (i.e. deeper into
  // the "root" half of the row) than a normal tooth's CEJ-aligned
  // position, so the crown itself ends up entirely past where the gumline
  // sits, "below the gum line." Since maxRootMm (and so rootZonePx/the
  // ruler's own ticks) was computed from the row's ordinary, non-submerged
  // teeth, that extra depth pushes the impacted tooth's root past the
  // deepest ruler line already drawn for this row — per her explicit
  // instruction, the root is clipped off exactly at that line, not left to
  // run further into (or past) the row's own margin. lastRootTickMm is the
  // same floor-to-nearest-2mm value the ticks loop above already used for
  // its own last root-direction tick (rulerUpMm for upper, rulerDownMm for
  // lower — both equal maxRootMm), so the clip lines up with the actual
  // drawn line, not just the raw (pre-rounding) root length.
  const lastRootTickMm = Math.floor(maxRootMm / RULER_STEP_MM) * RULER_STEP_MM;
  const rootLineY = cejY - coronalSign * lastRootTickMm * PX_PER_MM;
  const impactedClipId = useId();

  // One flat array of {x, y} gumline points across the whole quadrant — 3
  // per tooth — used to draw the connecting line and to anchor the REC
  // labels next to where the gum actually sits.
  const gumPoints = fdis.flatMap((fdi, i) => {
    const colX = i * (COLUMN_WIDTH + COLUMN_GAP);
    // Impacted teeth have never erupted, so there's no gum margin to
    // measure at all — per Monika's explicit request, the gumline reads
    // flat (at the CEJ, i.e. "0 recession") there regardless of whatever
    // gumMargin data might exist for that tooth.
    const gm = statuses?.[fdi] === 'impacted' ? ([0, 0, 0] as GumMargin) : (gumMargin?.[fdi] ?? [0, 0, 0]);
    return POINT_X_FRACTIONS.map((frac, j) => ({
      x: colX + COLUMN_WIDTH * frac,
      // gm is signed toward the crown (positive = coronal), and
      // coronalSign is the y-direction that "toward the crown" points in
      // for this arch — so adding the two moves recession (negative gm)
      // toward the root, and gum overgrowth (positive gm) toward the
      // crown, regardless of arch. A tooth mid-entry can have some points
      // set and others still null (see GumMargin in types/dental.ts) — the
      // line is a continuous visual guide, not itself the recorded data,
      // so an unset point just reads as "at the CEJ" here, same as a
      // whole-tooth-absent default already does.
      y: cejY + (gm[j] ?? 0) * PX_PER_MM * coronalSign,
    }));
  });

  return (
    <svg width={totalWidth} height={svgHeight} viewBox={`0 0 ${totalWidth} ${svgHeight}`} role="img" aria-label="Parodontalni graf">
      <defs>
        <clipPath id={impactedClipId}>
          {coronalSign === 1 ? (
            <rect x={0} y={rootLineY} width={totalWidth} height={svgHeight - rootLineY} />
          ) : (
            <rect x={0} y={0} width={totalWidth} height={rootLineY} />
          )}
        </clipPath>
      </defs>
      {ticks.map((mm) => {
        const y = cejY - mm * PX_PER_MM;
        return (
          <g key={mm}>
            <line x1={0} y1={y} x2={totalWidth} y2={y} stroke="#e2e8e6" strokeWidth={0.5} />
            <text x={-3} y={y} fontSize={5.5} textAnchor="end" dominantBaseline="middle" fill="#869390">
              {mm === 0 ? 'CEJ' : Math.abs(mm)}
            </text>
          </g>
        );
      })}
      {fdis.map((fdi, i) => {
        const profile = TOOTH_PROFILES[fdi];
        const colX = i * (COLUMN_WIDTH + COLUMN_GAP);
        const toothX = colX + (COLUMN_WIDTH - profile.displayWidth) / 2;
        const displayGingivaY = profile.gingivaY * (profile.displayHeight / profile.height);
        const impacted = statuses?.[fdi] === 'impacted';
        // profile.crownLengthMm * PX_PER_MM converts directly to display px
        // (no raw-pixel-space ratio needed) because displayHeight itself is
        // built from the same totalLengthMm * PX_PER_MM scale — see
        // toothProfiles.ts.
        const submergePx = impacted ? profile.crownLengthMm * PX_PER_MM : 0;
        const toothY = cejY - displayGingivaY - coronalSign * submergePx;

        const toothSvg = (
          <svg
            key={fdi}
            x={toothX}
            y={toothY}
            width={profile.displayWidth}
            height={profile.displayHeight}
            viewBox={`0 0 ${profile.width} ${profile.height}`}
            style={{ overflow: 'visible' }}
          >
            <ToothSideViewContent fdi={fdi} arch={arch} profile={profile} status={statuses?.[fdi]} />
          </svg>
        );
        // The clip is applied via a plain, untransformed wrapping <g> rather
        // than directly on the tooth's own nested <svg> (which carries both
        // a translate, from x/y, and a scale, from viewBox → width/height).
        // clip-path's coordinate system on an element that ALSO carries its
        // own transform is genuinely ambiguous across the spec/engines —
        // putting it on a <g> with no transform of its own guarantees the
        // clip rect (defined in impactedClipId above, in this same outer
        // <svg>'s coordinates) is read in exactly that outer coordinate
        // system, not reinterpreted through the tooth's own local viewBox.
        return impacted ? (
          <g key={fdi} clipPath={`url(#${impactedClipId})`}>
            {toothSvg}
          </g>
        ) : (
          toothSvg
        );
      })}

      {/* Gumline (and its CEJ reference + REC labels) drawn last, on top of
          every tooth's artwork — same as Curve Dental, where the wavy line
          and its numbers are clearly visible crossing over the crowns
          rather than being painted over by them. */}
      <line x1={0} y1={cejY} x2={totalWidth} y2={cejY} stroke="#c3cdca" strokeWidth={0.75} strokeDasharray="2 2" />
      <polyline
        points={gumPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke="#EF9F27"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
      {fdis.map((fdi, i) => {
        // Impacted teeth always show their REC number, forced to 0 — this
        // is a known, definite fact ("no recession, unerupted"), not
        // missing data, so it's shown the same way a real [0,0,0] entry
        // would be for any other tooth, regardless of whether gumMargin
        // actually has an entry for this fdi. Never interactive, though —
        // nothing to probe on a tooth that's never erupted.
        const impacted = statuses?.[fdi] === 'impacted';
        const gm = impacted ? ([0, 0, 0] as GumMargin) : gumMargin?.[fdi];
        const colX = i * (COLUMN_WIDTH + COLUMN_GAP);
        const xs = POINT_X_FRACTIONS.map((frac) => colX + COLUMN_WIDTH * frac);
        return (
          <RecLabels
            key={fdi}
            fdi={fdi}
            xs={xs}
            y={recRowY}
            gumMm={gm}
            onPointClick={impacted ? undefined : onPointClick}
            focusedPoint={focusedPoint}
          />
        );
      })}
    </svg>
  );
}

function RecLabels({
  fdi,
  xs,
  y,
  gumMm,
  onPointClick,
  focusedPoint,
}: {
  fdi: string;
  xs: number[];
  y: number;
  /** Undefined when this tooth has no gum-margin entry at all yet — still renders 3 (invisible, when interactive) hit targets so an empty tooth can be clicked to start entry. */
  gumMm?: GumMargin;
  onPointClick?: (point: GumPoint) => void;
  focusedPoint?: PerioPoint | null;
}) {
  return (
    <>
      {([0, 1, 2] as const).map((i) => {
        const mm = gumMm?.[i];
        const point: GumPoint = { kind: 'gum', fdi, index: i };
        const interactive = !!onPointClick;
        const focused = interactive && samePerioPoint(focusedPoint, point);
        return (
          <g key={i}>
            {focused && <circle cx={xs[i]} cy={y} r={REC_HIT_RADIUS} fill="none" stroke={SELECTED_COLOR} strokeWidth={1.5} />}
            {interactive && mm == null && (
              <circle cx={xs[i]} cy={y} r={REC_PLACEHOLDER_RADIUS} fill="none" stroke={PLACEHOLDER_COLOR} strokeWidth={1} strokeDasharray="1 1" />
            )}
            {/* Shown as a plain magnitude (no "-") since recession is the
                expected case clinically and the sign reads as noise — the
                actual signed value still drives which side of the CEJ the
                gumline dot/label sit on. */}
            {mm != null && (
              <text x={xs[i]} y={y + 0.5} fontSize={5.5} textAnchor="middle" dominantBaseline="middle" fill={REC_LABEL_COLOR}>
                {Math.abs(mm)}
              </text>
            )}
            {interactive && (
              <circle
                cx={xs[i]}
                cy={y}
                r={REC_HIT_RADIUS}
                fill="none"
                stroke="none"
                style={{ pointerEvents: 'all', cursor: 'pointer' }}
                onClick={() => onPointClick?.(point)}
              />
            )}
          </g>
        );
      })}
    </>
  );
}
