import { useRef, useState, type MouseEvent } from 'react';
import type { Surface, SurfaceMap, ToothStatus } from '../../types/dental';
import { TOOTH_META, surfaceLabel } from '../../data/toothMeta';
import { STATUS_STYLES } from '../../data/statusStyles';
import { statusFor, hidesSurfaceDetail } from '../chart/ToothTopView';
import { SurfaceChip } from './SurfaceChip';
import { StatusPicker } from './StatusPicker';

interface ToothDetailPanelProps {
  fdi: string;
  surfaces: SurfaceMap | undefined;
  notes: string | undefined;
  /** Merges into the tooth's SurfaceMap — touches only this one surface. */
  onSurfaceStatusChange: (surface: Surface, status: ToothStatus) => void;
  /** REPLACES the tooth's whole SurfaceMap with { all: status } — clears any per-surface overrides, so the chart can't end up showing a stale surface finding that contradicts the just-picked whole-tooth status. */
  onWholeToothStatusChange: (status: ToothStatus) => void;
  onNotesChange: (notes: string) => void;
}

type Target = Surface | 'all';

// Detail panel opened below the chart when a tooth is selected — CLAUDE.md's
// own "Interaction Design" spec. Render this with `key={fdi}` from the
// parent (PatientChart.tsx) so switching teeth remounts it fresh: no
// leftover open-picker state bleeding from one tooth to the next, no extra
// effect needed to reset it by hand.
export function ToothDetailPanel({
  fdi,
  surfaces,
  notes,
  onSurfaceStatusChange,
  onWholeToothStatusChange,
  onNotesChange,
}: ToothDetailPanelProps) {
  const meta = TOOTH_META[fdi];
  const [activeTarget, setActiveTarget] = useState<Target | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Same fallback statusFor() itself uses (surfaces.all ?? 'healthy') — the
  // whole-tooth control's own displayed value must agree with what every
  // surface chip resolves to when it has no override of its own.
  const wholeStatus = surfaces?.all ?? 'healthy';
  const hidesDetail = hidesSurfaceDetail(wholeStatus);

  function toggleTarget(target: Target, e: MouseEvent<HTMLButtonElement>) {
    triggerRef.current = e.currentTarget;
    // Tapping the already-open chip again collapses it — retargeting to a
    // *different* chip while one is open just swaps in place, no need to
    // close-then-reopen.
    setActiveTarget((prev) => (prev === target ? null : target));
  }

  function closePicker() {
    setActiveTarget(null);
    triggerRef.current?.focus();
  }

  function handlePick(status: ToothStatus) {
    if (activeTarget === 'all') onWholeToothStatusChange(status);
    else if (activeTarget) onSurfaceStatusChange(activeTarget, status);
    closePicker();
  }

  const pickerValue = activeTarget === 'all' ? wholeStatus : activeTarget ? statusFor(surfaces, activeTarget) : undefined;

  return (
    <div className="flex flex-col gap-4 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-5">
      <div>
        <h2 className="text-base font-semibold text-[var(--ink,#1c2624)]">Zob {fdi}</h2>
        <p className="text-xs text-[var(--ink-soft,#45524f)]">{meta.type === 'ant' ? 'Anteriorni zob' : 'Posteriorni zob'}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted,#6f7c79)]">Cel zob</span>
        <div>
          <SurfaceChip
            label="Cel zob"
            status={wholeStatus}
            active={activeTarget === 'all'}
            onClick={(e) => toggleTarget('all', e)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted,#6f7c79)]">Ploskve</span>
        {hidesDetail && (
          <p className="text-xs text-[var(--ink-soft,#45524f)]">
            Status "{STATUS_STYLES[wholeStatus].label}" se prikaže samo za cel zob — spremembe posameznih ploskev
            trenutno ne bodo vidne na karti.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {meta.surfaces.map((surface) => (
            <SurfaceChip
              key={surface}
              label={surfaceLabel(meta.type, surface)}
              status={statusFor(surfaces, surface)}
              active={activeTarget === surface}
              onClick={(e) => toggleTarget(surface, e)}
            />
          ))}
        </div>
      </div>

      {activeTarget !== null && <StatusPicker value={pickerValue} onSelect={handlePick} onDismiss={closePicker} />}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`notes-${fdi}`} className="text-[11px] uppercase tracking-[0.08em] text-[var(--muted,#6f7c79)]">
          Opombe
        </label>
        {/* Plain controlled input, no debounce — debouncing is a
            Supabase-auto-save concern (CLAUDE.md's "Status change flow"),
            explicitly deferred until this feature is wired to real
            patient/visit records. */}
        <textarea
          id={`notes-${fdi}`}
          value={notes ?? ''}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={2}
          className="rounded border border-[var(--line,#ccd6d4)] p-2 text-sm text-[var(--ink,#1c2624)]"
        />
      </div>
    </div>
  );
}
