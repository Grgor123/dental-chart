import type { EndoStage } from '../../types/dental';
import { endoColorFor } from '../../data/statusStyles';
import { StatusSymbol } from './StatusSymbol';

interface EndoSwatchProps {
  stage: EndoStage;
  /** On-screen size in px; the internal viewBox stays fixed at 22×22 regardless, same convention as StatusSwatch.tsx/PostSwatch.tsx. */
  size?: number;
}

// Representative icon for endodontic treatment (kanal) — not a ToothStatus
// anymore (see EndoStage in types/dental.ts), so it doesn't go through
// StatusSwatch, but per Monika's explicit "uniform service presentation"
// request it must still render the same way every real status does
// wherever services are listed (StatusToolbar.tsx, StatusLegend.tsx): one
// small icon + one label, same size, same button/row shape. One component
// parameterized by `stage`, not three separate components — same pattern
// StatusSwatch itself uses to cover many statuses through one component —
// reusing the exact endo-circle symbol/geometry ToothTopView.tsx draws on
// the real chart (a circle touching the swatch's own corners) and the same
// endoColorFor() color mapping.
export function EndoSwatch({ stage, size = 22 }: EndoSwatchProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" className="shrink-0">
      <StatusSymbol symbol="endo-circle" x={1} y={1} width={20} height={20} strokeWidth={2.25} color={endoColorFor(stage)} />
    </svg>
  );
}
