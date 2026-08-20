import type { ToothStatus } from '../../types/dental';
import { STATUS_STYLES, TODO_COLOR, DONE_COLOR, STATUS_COLOR } from '../../data/statusStyles';
import { StatusSymbol } from './StatusSymbol';
import { BOP_COLOR } from '../chart/perioStyle';

// bridge_anchor, planned, granuloma, diastema, and root_only were all
// removed per Monika's explicit request (see CLAUDE.md's "Status color
// palette" for the reasoning behind each). prosthesis_crown is a real,
// still-live status (it drives the prosthesis connector line — see
// "Bridge display" in CLAUDE.md) but is deliberately left OUT of this
// legend: it renders identically to `crown` in a flat swatch like this one
// (no circle, no symbol — the connector-line behavior only shows up on the
// real chart, not an isolated swatch), so showing both here would just be
// the same teal square twice.
const ORDER: ToothStatus[] = [
  'healthy', 'caries', 'caries_treated', 'filling', 'crown', 'endo', 'endo_planned', 'endo_existing', 'implant',
  'bridge_pontic', 'abrasion', 'overlay_planned', 'overlay', 'overlay_existing',
  'impacted', 'extraction_planned', 'extracted', 'missing', 'prosthesis',
];

export function StatusLegend() {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
      {ORDER.map((status) => {
        const style = STATUS_STYLES[status];
        // Prosthesis renders as a circle on the real chart (ToothTopView.tsx),
        // not the usual square swatch — reproduce that here too.
        const isProsthesis = status === 'prosthesis';
        // Caries/caries_treated/filling have no fill or symbol of their own
        // — on the real chart they're a per-surface dot (ToothTopView.tsx),
        // so the legend shows one representative dot centered in the swatch.
        const cariesDotColor =
          status === 'caries' ? TODO_COLOR : status === 'caries_treated' ? DONE_COLOR : status === 'filling' ? STATUS_COLOR : undefined;
        // overlay_planned/overlay have no fill or symbol of their own either
        // — on the real chart they're a "[" -shaped cap drawn in BridgeRow's
        // own row, not on the tooth itself (see "Bridge display" in
        // CLAUDE.md), so the legend draws a small representative cap in the
        // swatch, same idea as the caries dot above.
        const overlayCapColor =
          status === 'overlay_planned' ? TODO_COLOR : status === 'overlay' ? DONE_COLOR : status === 'overlay_existing' ? STATUS_COLOR : undefined;
        // missing/extracted drop their square's own outline entirely on the
        // real chart (ToothTopView.tsx's isAbsentSilhouette, stroke="none")
        // — "just keep the filling," per Monika's explicit request — so the
        // legend swatch matches instead of showing the stale dark border.
        const noBorder = status === 'missing' || status === 'extracted';
        return (
          <div key={status} className="flex items-center gap-2.5">
            <svg width={22} height={22} viewBox="0 0 22 22" className="shrink-0">
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
            </svg>
            <span className="text-sm text-[var(--ink,#1c2624)]">{style.label}</span>
          </div>
        );
      })}
      {/* Sealant isn't a ToothStatus either (it's ToothData.sealant, a
          SealantStage independent of surfaces.all — see BridgeRow.tsx), so
          its three stages are added here by hand, same reasoning as BOP
          below: one small tilde per stage, in the same colors BridgeRow's
          own sealantColorFor() uses. */}
      {([
        ['existing', STATUS_COLOR, 'Zalitje fisur (obstoječe)'],
        ['planned', TODO_COLOR, 'Zalitje fisur (predvideno)'],
        ['done', DONE_COLOR, 'Zalitje fisur (opravljeno)'],
      ] as const).map(([stage, color, label]) => (
        <div key={stage} className="flex items-center gap-2.5">
          <svg width={22} height={22} viewBox="0 0 22 22" className="shrink-0">
            <path d="M4,13 C6,9 8,9 11,13 C14,17 16,17 18,13" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
          </svg>
          <span className="text-sm text-[var(--ink,#1c2624)]">{label}</span>
        </div>
      ))}
      {/* BOP isn't a ToothStatus (it's a per-point flag on the perio graph's
          pocket-depth circles, not a tooth/surface status), so it's added
          here by hand rather than through ORDER — same red ring rendering
          as PocketDepthRow's bled points, via the shared BOP_COLOR. */}
      <div className="flex items-center gap-2.5">
        <svg width={22} height={22} viewBox="0 0 22 22" className="shrink-0">
          <circle cx={11} cy={11} r={7} fill="#fff" stroke={BOP_COLOR} strokeWidth={3} />
        </svg>
        <span className="text-sm text-[var(--ink,#1c2624)]">Krvavitev ob sondiranju (BOP)</span>
      </div>
    </div>
  );
}
