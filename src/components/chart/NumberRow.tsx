import type { MouseEvent } from 'react';
import { COLUMN_WIDTH, COLUMN_GAP } from '../../data/toothProfiles';

interface NumberRowProps {
  fdis: readonly string[];
  /**
   * Direct click targeting for the new selection/paint flow
   * (PatientChart.tsx) — the FDI number is the explicit "target the whole
   * tooth" affordance, since once individual surfaces have their own click
   * zones on the tloris square itself, there's no leftover space on the
   * square to mean "the whole tooth." Always fires with 'all', same
   * callback shape ToothTopView's own zone clicks use.
   */
  onTargetClick?: (fdi: string, target: 'all', e: MouseEvent) => void;
  /** True if ANY target on this tooth is selected (not just 'all') — same coarser check TlorisRow.tsx's own square outline uses, so the two always agree on which tooth is "current." */
  isFdiSelected?: (fdi: string) => boolean;
}

// FDI tooth-number labels for one quadrant, split out from the tloris
// squares so a PocketDepthRow can sit between the two.
export function NumberRow({ fdis, onTargetClick, isFdiSelected }: NumberRowProps) {
  return (
    <div className="flex items-start" style={{ gap: `${COLUMN_GAP}px` }}>
      {fdis.map((fdi) => {
        const selected = isFdiSelected?.(fdi) ?? false;
        return (
          <div key={fdi} className="flex flex-none justify-center" style={{ width: `${COLUMN_WIDTH}px` }}>
            <button
              type="button"
              onClick={(e) => onTargetClick?.(fdi, 'all', e)}
              className="rounded-sm px-0.5 font-mono text-[11px] tabular-nums text-[var(--ink-soft,#45524f)]"
              style={selected ? { backgroundColor: 'var(--tooth-selected, #2e6e62)', color: '#fff' } : undefined}
              aria-label={`Ciljaj cel zob ${fdi}`}
              aria-pressed={selected}
            >
              {fdi}
            </button>
          </div>
        );
      })}
    </div>
  );
}
