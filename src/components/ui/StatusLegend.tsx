import { STATUS_STYLES, STATUS_ORDER, ENDO_STAGE_LABELS } from '../../data/statusStyles';
import type { EndoStage } from '../../types/dental';
import { StatusSwatch } from './StatusSwatch';
import { PostSwatch } from './PostSwatch';
import { EndoSwatch } from './EndoSwatch';
import { BOP_COLOR } from '../chart/perioStyle';

const ENDO_STAGES: EndoStage[] = ['planned', 'done', 'existing'];

// STATUS_ORDER (statusStyles.ts) is the full canonical list, shared with the
// click-to-edit StatusPicker — this legend filters `prosthesis_crown` back
// out for its own display only: it renders identically to `crown` in a flat
// swatch like this one (no circle, no symbol — the connector-line behavior
// only shows up on the real chart, not an isolated swatch), so showing both
// here would just be the same teal square twice. A picker shows each
// option's label right next to its swatch, so the two ARE distinguishable
// there, which is why STATUS_ORDER itself still includes it.
const ORDER = STATUS_ORDER.filter((status) => status !== 'prosthesis_crown');

export function StatusLegend() {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
      {ORDER.map((status) => {
        const style = STATUS_STYLES[status];
        return (
          <div key={status} className="flex items-center gap-2.5">
            <StatusSwatch status={status} />
            <span className="text-sm text-[var(--ink,#1c2624)]">{style.label}</span>
          </div>
        );
      })}
      {/* Zobni zatiček (dental post) isn't a ToothStatus (see
          ToothTopView.tsx's hasPost — a plain per-tooth boolean, kept
          separate so it can coexist with whatever status a tooth already
          has), so it's added here by hand rather than through ORDER — same
          PostSwatch icon StatusToolbar.tsx uses for its own grid entry, per
          Monika's explicit request that every service read the same way
          wherever services are listed. */}
      <div className="flex items-center gap-2.5">
        <PostSwatch />
        <span className="text-sm text-[var(--ink,#1c2624)]">Zobni zatiček</span>
      </div>
      {/* Endodontic treatment (kanal) isn't a ToothStatus either anymore
          (see EndoStage in types/dental.ts) — it needs to coexist with
          whatever status a tooth already has (a filling AND a completed
          root canal at once, say), so it's threaded independently like
          post above and, per the same uniform-presentation request, gets
          one hand-added row per stage here rather than through ORDER. */}
      {ENDO_STAGES.map((stage) => (
        <div key={stage} className="flex items-center gap-2.5">
          <EndoSwatch stage={stage} />
          <span className="text-sm text-[var(--ink,#1c2624)]">{ENDO_STAGE_LABELS[stage]}</span>
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
