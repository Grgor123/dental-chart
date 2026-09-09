import type { ToothStatus } from '../../types/dental';
import { STATUS_STYLES, TODO_COLOR, DONE_COLOR, STATUS_COLOR } from '../../data/statusStyles';
import { StatusSymbol } from './StatusSymbol';

interface StatusSwatchProps {
  status: ToothStatus;
  /** On-screen size in px; the internal viewBox stays fixed at 22×22 regardless, so the swatch stays crisp at any size. */
  size?: number;
}

// Single source of truth for "how do we draw a representative icon for this
// status" — extracted out of StatusLegend.tsx so the Legenda and the
// click-to-edit StatusPicker (ToothDetailPanel.tsx) render identical
// swatches instead of two copies of this same special-casing drifting apart.
export function StatusSwatch({ status, size = 22 }: StatusSwatchProps) {
  const style = STATUS_STYLES[status];
  // Prosthesis renders as a circle on the real chart (ToothTopView.tsx),
  // not the usual square swatch — reproduce that here too.
  const isProsthesis = status === 'prosthesis';
  // Caries/caries_treated/filling have no fill or symbol of their own — on
  // the real chart they're a per-surface dot (ToothTopView.tsx), so the
  // swatch shows one representative dot centered in it.
  const cariesDotColor =
    status === 'caries' ? TODO_COLOR : status === 'caries_treated' ? DONE_COLOR : status === 'filling' ? STATUS_COLOR : undefined;
  // overlay_planned/overlay have no fill or symbol of their own either — on
  // the real chart they're a "[" -shaped cap drawn in BridgeRow's own row,
  // not on the tooth itself (see "Bridge display" in CLAUDE.md), so the
  // swatch draws a small representative cap, same idea as the caries dot.
  const overlayCapColor =
    status === 'overlay_planned' ? TODO_COLOR : status === 'overlay' ? DONE_COLOR : status === 'overlay_existing' ? STATUS_COLOR : undefined;
  // sealant_planned/sealant/sealant_existing have no fill or symbol of
  // their own either — on the real chart they're a small tilde drawn in
  // BridgeRow's own row (see "Bridge display" in CLAUDE.md), so the swatch
  // draws a representative tilde, same idea as the caries dot/overlay cap.
  const sealantTildeColor =
    status === 'sealant_planned' ? TODO_COLOR : status === 'sealant' ? DONE_COLOR : status === 'sealant_existing' ? STATUS_COLOR : undefined;
  // missing/extracted drop their square's own outline entirely on the real
  // chart (ToothTopView.tsx's isAbsentSilhouette, stroke="none") — "just
  // keep the filling," per Monika's explicit request — so the swatch
  // matches instead of showing a stale dark border.
  const noBorder = status === 'missing' || status === 'extracted';

  return (
    <svg width={size} height={size} viewBox="0 0 22 22" className="shrink-0">
      {isProsthesis ? (
        <circle
          cx={11}
          cy={11}
          r={10}
          fill="none"
          stroke={style.border ?? '#1f1e20'}
          strokeWidth={1.25}
          strokeDasharray={style.borderDash ? '2.5 2' : undefined}
        />
      ) : (
        <rect
          x={1}
          y={1}
          width={20}
          height={20}
          rx={3}
          fill={style.fill === 'none' ? 'none' : style.fill}
          stroke={noBorder ? 'none' : (style.border ?? '#1f1e20')}
          strokeWidth={1.25}
          strokeDasharray={style.borderDash ? '2.5 2' : undefined}
        />
      )}
      {style.symbol && (
        <StatusSymbol
          symbol={style.symbol}
          x={4}
          y={4}
          width={14}
          height={14}
          color={style.symbolColor ?? style.border ?? '#1f1e20'}
        />
      )}
      {cariesDotColor && <circle cx={11} cy={11} r={1.5} fill={cariesDotColor} stroke="none" />}
      {overlayCapColor && (
        <path d="M6,16 L6,8 L16,8 L16,16" fill="none" stroke={overlayCapColor} strokeWidth={2} strokeLinecap="square" />
      )}
      {sealantTildeColor && (
        <path
          d="M4,13 C6,9 8,9 11,13 C14,17 16,17 18,13"
          fill="none"
          stroke={sealantTildeColor}
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
