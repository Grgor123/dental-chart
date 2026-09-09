import type { MouseEvent } from 'react';
import type { ToothStatus } from '../../types/dental';
import { STATUS_STYLES } from '../../data/statusStyles';
import { StatusSwatch } from './StatusSwatch';

interface SurfaceChipProps {
  /** Precomputed Slovene surface name (e.g. via surfaceLabel() in toothMeta.ts) — this component doesn't know ant/post, just displays what it's given. */
  label: string;
  /** Already-resolved status for this surface (e.g. via statusFor() in ToothTopView.tsx) — falls back through surfaces.all/'healthy' upstream, not here. */
  status: ToothStatus;
  /** Whether this chip's own StatusPicker is currently open. */
  active: boolean;
  /** Receives the click event (not just a bare callback) so the caller can capture e.currentTarget for focus restoration once the picker closes. */
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}

// One tappable chip per surface (or the whole-tooth control, which reuses
// this same component with its own fixed label) in ToothDetailPanel.tsx —
// per CLAUDE.md's own file tree, this was always meant to live at exactly
// this path ("Clickable surface badge"). Deliberately dumb: no Surface/
// ToothType knowledge of its own, so it can't get the ant/post label
// distinction wrong — that's surfaceLabel()'s job, not this component's.
export function SurfaceChip({ label, status, active, onClick, disabled }: SurfaceChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        borderColor: active ? 'var(--tooth-selected, #2e6e62)' : 'var(--line, #ccd6d4)',
        backgroundColor: active ? 'color-mix(in srgb, var(--tooth-selected, #2e6e62) 12%, transparent)' : 'var(--surface, #fff)',
      }}
    >
      <StatusSwatch status={status} size={18} />
      <span className="flex flex-col leading-tight">
        <span className="text-[var(--ink,#1c2624)]">{label}</span>
        <span className="text-[var(--ink-soft,#45524f)]">{STATUS_STYLES[status].label}</span>
      </span>
    </button>
  );
}
