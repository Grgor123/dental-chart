import type { Arch } from '../../data/toothMeta';
import { TOOTH_PROFILES, type ToothProfile } from '../../data/toothProfiles';
import type { ToothStatus } from '../../types/dental';
import { STATUS_STYLES, ABSENT_SILHOUETTE_COLOR } from '../../data/statusStyles';
import { StatusSymbol } from '../ui/StatusSymbol';

const ROOT_COLOR = '#D8D5CC';
// Two-tone implant fixture, matching a reference photo: a warm tan
// abutment collar at the gumline, then a distinctly blue-grey threaded
// screw — bolder colors than the rest of the chart on purpose, so the
// fixture reads as a different material at a glance, not just a grey root.
const ABUTMENT_FILL = '#D6B98C';
const ABUTMENT_STROKE = '#8B6F47';
const SHAFT_FILL = '#8C9CAB';
const SHAFT_STROKE = '#4A5966';
// Every implant fixture uses this one real-world root length — tooth 48's
// (11mm, tied for the shortest root in the whole anatomy table, so no
// other tooth's own root zone is ever too short to contain it) — instead
// of each tooth's own (very different) root length, so implants read as
// consistent-size hardware across the chart rather than scaling with
// whichever tooth happens to host one.
const REFERENCE_ROOT_LENGTH_MM = TOOTH_PROFILES['48'].rootLengthMm;
// Abrasion (tooth wear): side view should not tint the whole crown red —
// the crown keeps its normal white fill, and instead its own outline (the
// whole visible crown edge: mesial, distal, and incisal/occlusal) is
// traced in red, echoing the tloris view's own line-only (not fill)
// treatment for this status. Target real on-screen weight matches that
// view's own abrasion/endo exceptions to the chart's usual 1px lines
// (3px) — a flat "3" doesn't translate directly to this view's own raw
// viewBox units, though; see its use site (below) for the scale
// conversion this constant actually needs.
const ABRASION_EDGE_COLOR = '#9D1616';
const ABRASION_EDGE_STROKE_WIDTH = 2;
// Extraction pair's X-cross (extraction_planned/extracted — the only two
// statuses that reach the x-cross render block below): 3px, matching the
// tloris view's own 3px weight for the same pair, per Monika's explicit
// request. Same "target real px" vs. "raw viewBox units" mismatch as
// ABRASION_EDGE_STROKE_WIDTH above — see its use site for the conversion.
const EXTRACTION_X_STROKE_WIDTH = 3;

interface ToothSideViewContentProps {
  fdi: string;
  arch: Arch;
  profile: ToothProfile;
  /** Whole-tooth status (surfaces.all) — same simplification as ToothTopView for now. */
  status?: ToothStatus;
}

// The <defs>/<g> content only — no outer <svg>, so it can be embedded either
// in its own standalone viewBox (ToothSideView, below) or nested inside a
// shared multi-tooth <svg> like PerioGraphRow, which needs every tooth's
// CEJ (gingivaY) aligned to one common y-coordinate across the row.
export function ToothSideViewContent({ fdi, arch, profile, status }: ToothSideViewContentProps) {
  const crownTop = arch === 'upper' ? profile.gingivaY : 0;
  const crownHeight = arch === 'upper' ? profile.height - profile.gingivaY : profile.gingivaY;
  const clipId = `sclip-${fdi}`;
  const silhouetteClipId = `silclip-${fdi}`;

  const style = status ? STATUS_STYLES[status] : undefined;
  const outlineColor = style?.border ?? '#1f1e20';
  const isImplant = status === 'implant';
  // Bridge pontic: no natural tooth structure at all ("brez korenine") —
  // per Monika's explicit request, neither the root NOR the crown are
  // drawn; a pontic crown spans between anchor teeth with nothing of its
  // own underneath or shown. hidesRoot still covers pontic (it also needs
  // the root hidden, same as implant/prosthesis); hidesCrown is the
  // extra step (shared with prosthesis, below) that removes the crown
  // too.
  const isPontic = status === 'bridge_pontic';
  // Prosthesis (removable-denture) tooth: no natural tooth structure at
  // all, same as pontic — per Monika's explicit follow-up request, the
  // side view now hides the crown too, not just the root (an earlier
  // version kept the crown shown, on the reasoning that a denture tooth
  // "still has a crown shown above, just no root" — reverted once she
  // asked for it removed). And (unlike the tloris view) no x-cross
  // either, since that reads as "extracted/missing" rather than "replaced
  // by a denture" — handled below, where the generic x-cross block
  // excludes this status specifically.
  const isProsthesis = status === 'prosthesis';
  const hidesRoot = isImplant || isPontic || isProsthesis;
  const hidesCrown = isPontic || isProsthesis;
  // Abrasion: crown stays its normal (white) fill — its own outline is
  // traced in red instead, drawn separately below, instead of the flat
  // STATUS_STYLES.abrasion.fill covering the whole crown.
  const isAbrasion = status === 'abrasion';
  // 'missing' (never present) and 'extracted' (removed) both render as a
  // flat, uniformly light silhouette (ABSENT_SILHOUETTE_COLOR, statusStyles.ts)
  // instead of the usual crown/root color split with ink detail — no real
  // tooth structure to show detail of, whether it was never there or is
  // now gone. They differ only in the symbol drawn on top: `extracted` gets
  // a blue X (marking "used to be here"), `missing` gets none at all — see
  // STATUS_STYLES for both.
  const isAbsentSilhouette = status === 'missing' || status === 'extracted';
  // Still physically present, just flagged for removal — a normal-looking
  // tooth (white crown, full ink detail, like `healthy`) with a red X
  // drawn on top; see the isExtractionPlanned use below and its symbol
  // block further down.
  const isExtractionPlanned = status === 'extraction_planned';
  // Overlay (planned, done, or pre-existing) doesn't change a tooth's
  // outward appearance in this view at all — it's marked entirely by
  // BridgeRow's own cap symbol, not anything drawn on the tooth itself —
  // so it needs the same white-crown fix as endo/extraction_planned above,
  // for the same reason: STATUS_STYLES.overlay*.fill is 'none' with no
  // symbol of its own here, so without this it would fall through to the
  // see-through-grey look.
  const isOverlayStatus = status === 'overlay_planned' || status === 'overlay' || status === 'overlay_existing';
  // Fissure sealant (sealant_planned/sealant/sealant_existing) — same
  // reasoning as isOverlayStatus above: marked entirely by BridgeRow's own
  // tilde, fill: 'none' with no symbol here, so it needs the same fix.
  const isSealantStatus = status === 'sealant_planned' || status === 'sealant' || status === 'sealant_existing';

  // Healthy crowns get an explicit white fill (distinct from the root's
  // grey) rather than falling through to 'none'. No current status relies
  // on that bare fallback on purpose anymore (root_only used to — a
  // no-fill status left deliberately transparent so its dashed border read
  // against the grey root underneath — but it was removed entirely per
  // Monika's explicit request); the ternary below still needs to handle
  // the fallback case for any future status that might.
  const isHealthy = !status || status === 'healthy';
  // `extraction_planned` needs the same white-crown fix `healthy` gets by
  // default — a tooth flagged for extraction is still fully present and
  // should look ordinary apart from its red X, not fall through to the
  // "no fill" statuses' deliberate see-through-to-grey. (Endodontic
  // treatment used to need this same fix too, back when it was a
  // ToothStatus with fill: 'none' and no side-view symbol of its own — now
  // that it's an independent field (EndoStage, threaded separately as
  // `endoStage` in ToothTopView.tsx) it's never part of `status` here at
  // all, so it can't trip this trap in the first place. Endo has no
  // side-view rendering by design — see CLAUDE.md's "Canal display".)
  // caries/caries_treated/filling fall into the exact same trap — fill:
  // 'none' in statusStyles.ts, with no side-view symbol of their own (the
  // dot marker is drawn in ToothTopView.tsx only) — so a whole-tooth
  // 'caries' status with no endo involvement (tooth 16 exposed this; every
  // other caries demo happened to be layered on top of endo/endo_planned,
  // which already fixed the crown) rendered the same solid-grey-whole-tooth
  // bug Monika originally caught on endo. `filling` joined this list once
  // it switched from a flat white fill to the same grey-dot mechanism.
  const isCariesStatus = status === 'caries' || status === 'caries_treated' || status === 'filling';
  const crownFill = isHealthy || isAbrasion || isExtractionPlanned || isOverlayStatus || isSealantStatus || isCariesStatus
    ? '#FFFFFF'
    : style?.fill && style.fill !== 'none'
      ? style.fill
      : 'none';

  // Abrasion outline: strokeWidth in this tooth's own raw viewBox units
  // (see the constant's own comment above for why a flat "3" doesn't work).
  const abrasionStrokeWidth = ABRASION_EDGE_STROKE_WIDTH * (profile.width / profile.displayWidth);
  // Its clip needs generous padding on the bite-edge/mesial/distal sides —
  // enough that the stroke's own outward-bleeding half (see the outline's
  // own render comment below) isn't itself clipped away — but must stay
  // exactly tight at the gumline (profile.gingivaY), since bleeding past
  // that boundary would read as marking the root too, not just the crown.
  const abrasionClipId = `aoclip-${fdi}`;
  const abrasionClipY = arch === 'upper' ? crownTop : -abrasionStrokeWidth;
  const abrasionClipHeight = crownHeight + abrasionStrokeWidth;

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x={-4} y={crownTop} width={profile.width + 8} height={crownHeight} />
        </clipPath>
        <clipPath id={silhouetteClipId}>
          <path d={profile.silhouette} />
        </clipPath>
        {isAbrasion && (
          <clipPath id={abrasionClipId}>
            <rect
              x={-abrasionStrokeWidth}
              y={abrasionClipY}
              width={profile.width + abrasionStrokeWidth * 2}
              height={abrasionClipHeight}
            />
          </clipPath>
        )}
      </defs>
      <g clipPath={`url(#${silhouetteClipId})`}>
        {/* Implant, bridge_pontic, and prosthesis all hide the traced
            natural root (fill + ink detail), clipped to the crown zone
            only — implant replaces it with ImplantFixture below; pontic
            and prosthesis replace it with nothing, since neither has a
            natural root. Pontic and prosthesis additionally skip the
            crown zone too (hidesCrown) — per Monika's explicit request,
            neither has any natural tooth structure at all, not even a
            crown, so nothing of the traced photo is drawn for either.
            Pontic's own dashed-outline border
            (STATUS_STYLES.bridge_pontic.borderDash) was removed too, per
            a later request; prosthesis never had one to begin with
            (STATUS_STYLES.prosthesis has no borderDash) — so both are
            simply blank in the side view: no crown, no root, no outline —
            with only their column position marking where they sit. */}
        {!hidesCrown && (
          <path
            d={profile.silhouette}
            fill={isAbsentSilhouette ? ABSENT_SILHOUETTE_COLOR : ROOT_COLOR}
            stroke="none"
            clipPath={hidesRoot ? `url(#${clipId})` : undefined}
          />
        )}
        {/* crownFill already resolves to ABSENT_SILHOUETTE_COLOR for
            missing/extracted (STATUS_STYLES.fill holds that color for
            both now), matching the base layer above — a uniform flat
            silhouette, not a crown/root color split. */}
        {!hidesCrown && <path d={profile.silhouette} clipPath={`url(#${clipId})`} fill={crownFill} stroke="none" />}
        {/* Missing/extracted: no ink-detail layer either — "just a
            silhouette," with nothing to suggest tooth structure that
            either was never there or is now gone. */}
        {!hidesCrown && !isAbsentSilhouette && (
          <path
            d={profile.detail}
            fillRule="evenodd"
            fill="#1f1e20"
            stroke="none"
            clipPath={hidesRoot ? `url(#${clipId})` : undefined}
          />
        )}
      </g>
      {!hidesCrown && isAbrasion && (
        // Drawn OUTSIDE the silhouette-clipped <g> above deliberately — a
        // stroke centered on that same silhouette path, drawn *inside* that
        // <g>, would have its outer half clipped away by the very shape
        // it's tracing (only the inward-facing half survives the clip),
        // which is why an earlier version of this line rendered at roughly
        // half its real 3px weight. Left unclipped by the silhouette here,
        // and clipped instead by abrasionClipId (padded generously on the
        // bite-edge/mesial/distal sides, tight only at the gumline — see
        // its own comment above), the full stroke shows, bleeding outward
        // past the crown's true edge — reading as a line on the crown's
        // own outer side, per Monika's explicit request.
        <path
          d={profile.silhouette}
          clipPath={`url(#${abrasionClipId})`}
          fill="none"
          stroke={ABRASION_EDGE_COLOR}
          strokeWidth={abrasionStrokeWidth}
        />
      )}
      {isImplant && <ImplantFixture profile={profile} arch={arch} />}
      {style?.borderDash && (
        // Clipped to the crown zone for any status that hides its root —
        // this path traces the *whole* silhouette (crown+root together), so
        // without the clip the root's natural outline would still show
        // through as a dashed line even though its fill/detail are already
        // hidden above. impacted has no root to hide, so it keeps the
        // full-silhouette outline as before. Neither missing nor extracted
        // set borderDash anymore (statusStyles.ts) — both are a plain,
        // undashed, light-filled silhouette instead — so this never fires
        // for them regardless.
        <path
          d={profile.silhouette}
          fill="none"
          stroke={outlineColor}
          strokeWidth={1.5}
          strokeDasharray="4 2.5"
          clipPath={hidesRoot ? `url(#${clipId})` : undefined}
        />
      )}
      {/* Prosthesis and bridge_pontic both skip the x-cross here even though
          STATUS_STYLES gives them symbol: 'x-cross' (used by the tloris
          view) — hidesCrown above already removes the whole tooth for
          both, so an x-cross with nothing else drawn around it would just
          look like a stray mark floating in empty space. `missing` never
          reaches this block at all — it has no symbol set in
          STATUS_STYLES anymore, per Monika's explicit request that it read
          as a plain light silhouette, not crossed out (crossing-out reads
          as "removed," which isn't what a congenitally-absent tooth is).
          `extracted`/`extraction_planned` both DO show their own X here —
          color comes from style?.symbolColor when set (blue for
          `extracted`, red for `extraction_planned`), falling back to
          outlineColor otherwise, same fallback order ToothTopView.tsx
          already uses for its own tloris-view cross. These two are also
          the only statuses that ever reach this block (prosthesis/pontic
          excluded above, missing has no symbol at all), so the 3px
          EXTRACTION_X_STROKE_WIDTH below applies unconditionally rather
          than needing its own status check. */}
      {style?.symbol === 'x-cross' && !isProsthesis && !isPontic && (
        <StatusSymbol
          symbol="x-cross"
          x={profile.width * 0.12}
          y={profile.height * 0.12}
          width={profile.width * 0.76}
          height={profile.height * 0.76}
          strokeWidth={EXTRACTION_X_STROKE_WIDTH * (profile.width / profile.displayWidth)}
          color={style?.symbolColor ?? outlineColor}
        />
      )}
    </>
  );
}

// Simplified implant fixture, replacing the traced natural root entirely
// for 'implant' status: a tan abutment collar at the gumline, then a
// straight-sided blue-grey screw with a blunt, gently rounded-off tip (not
// a sharp point) and dense internal thread lines across its full width —
// matched against a reference photo, which reads as a clean cylindrical
// screw rather than a jagged/zigzag post.
function ImplantFixture({ profile, arch }: { profile: ToothProfile; arch: Arch }) {
  const gumY = profile.gingivaY;
  const dir = arch === 'upper' ? -1 : 1;
  // profile.crownCenterX, not width/2 — a traced crown isn't necessarily
  // centered in its own bounding box, so width/2 visibly mis-centered the
  // screw under some crowns (see ToothProfile.crownCenterX for how it's
  // sampled).
  const centerX = profile.crownCenterX;

  // REFERENCE_ROOT_LENGTH_MM converted into THIS tooth's own raw-pixel
  // space (mm-per-raw-unit differs per tooth, since each source photo was
  // cropped independently — see toothProfiles.ts) — so every tooth's
  // fixture ends up the same real-world (and on-screen) length, rather
  // than reaching all the way to this tooth's own photo-edge root tip.
  // The *0.97 is a small safety margin: tooth 48 itself is tied for the
  // shortest root in the whole anatomy table, so this is already always
  // ≤ every tooth's own natural root-zone length, except that gingivaY is
  // rounded to the nearest px (toothProfiles.ts), which can eat that exact
  // equality by a fraction of a px on a tooth tied with 48 — the margin
  // absorbs that rounding rather than risking a sub-pixel clip.
  const rootLen = REFERENCE_ROOT_LENGTH_MM * 0.97 * (profile.height / profile.totalLengthMm);
  const tipY = gumY + dir * rootLen;

  const abutmentEndY = gumY + dir * rootLen * 0.18;
  const shaftEndY = gumY + dir * rootLen * 0.92;

  const abutmentTopW = profile.width * 0.46;
  const shaftW = profile.width * 0.36;
  const tipW = shaftW * 0.55;

  const abutmentPoints: [number, number][] = [
    [centerX - abutmentTopW / 2, gumY],
    [centerX + abutmentTopW / 2, gumY],
    [centerX + shaftW / 2, abutmentEndY],
    [centerX - shaftW / 2, abutmentEndY],
  ];
  const abutmentPath = `M${abutmentPoints.map(([x, y]) => `${x},${y}`).join(' L')} Z`;

  const shaftPoints: [number, number][] = [
    [centerX - shaftW / 2, abutmentEndY],
    [centerX + shaftW / 2, abutmentEndY],
    [centerX + shaftW / 2, shaftEndY],
    [centerX + tipW / 2, tipY],
    [centerX - tipW / 2, tipY],
    [centerX - shaftW / 2, shaftEndY],
  ];
  const shaftPath = `M${shaftPoints.map(([x, y]) => `${x},${y}`).join(' L')} Z`;

  // Evenly spaced ridge lines across the shaft's full width — the threads
  // are surface detail here, not the shaft's own silhouette, which is what
  // keeps the outline itself clean and cylindrical like the photo. Fewer,
  // more widely spaced lines than an earlier version (9), which read as
  // busy/faint; 5 stands out more clearly at this chart's small
  // on-screen size. Slightly angled (not perfectly horizontal), all
  // tilting the same way, so they read as one continuous helical thread
  // wrapping the screw rather than a stack of flat rings.
  const threadCount = 5;
  const threadGap = Math.abs(shaftEndY - abutmentEndY) / (threadCount + 1);
  const tilt = threadGap * 0.55;
  const threads = Array.from({ length: threadCount }, (_, i) => {
    const t = (i + 1) / (threadCount + 1);
    const y = abutmentEndY + (shaftEndY - abutmentEndY) * t;
    return (
      <line
        key={i}
        x1={centerX - shaftW / 2}
        y1={y - tilt}
        x2={centerX + shaftW / 2}
        y2={y + tilt}
        stroke={SHAFT_STROKE}
        strokeWidth={0.5}
      />
    );
  });

  return (
    <g strokeLinejoin="round">
      <path d={shaftPath} fill={SHAFT_FILL} stroke={SHAFT_STROKE} strokeWidth={0.9} />
      {threads}
      <path d={abutmentPath} fill={ABUTMENT_FILL} stroke={ABUTMENT_STROKE} strokeWidth={0.9} />
    </g>
  );
}

interface ToothSideViewProps {
  fdi: string;
  arch: Arch;
  profile: ToothProfile;
  status?: ToothStatus;
}

// Standalone version: owns its own <svg viewBox>. displayWidth/displayHeight
// are always constructed to match the photo's native aspect ratio (see
// toothProfiles.ts), so no letterboxing/cropping can occur regardless of
// preserveAspectRatio — left at the SVG default.
export function ToothSideView({ fdi, arch, profile, status }: ToothSideViewProps) {
  return (
    <svg
      viewBox={`0 0 ${profile.width} ${profile.height}`}
      width={profile.displayWidth.toFixed(1)}
      height={profile.displayHeight.toFixed(1)}
      role="img"
      aria-label={`Side view ${fdi}`}
      className="block max-w-full"
      style={{ overflow: 'visible' }}
    >
      <ToothSideViewContent fdi={fdi} arch={arch} profile={profile} status={status} />
    </svg>
  );
}
