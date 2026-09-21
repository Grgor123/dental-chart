import { useRef, useState, type MouseEvent } from 'react';
import type { Surface, SurfaceMap, ToothStatus } from '../../types/dental';
import { TOOTH_META, surfaceLabel } from '../../data/toothMeta';
import { STATUS_STYLES } from '../../data/statusStyles';
import { statusFor, hidesSurfaceDetail } from '../chart/ToothTopView';
import { useToothHistory } from '../../hooks/useToothHistory';
import { describeToothRecord } from '../../lib/describeToothRecord';
import { SurfaceChip } from './SurfaceChip';
import { StatusPicker } from './StatusPicker';

interface ToothDetailPanelProps {
  /** Which patient this tooth belongs to — needed only for the Zgodovina tab's own query (useToothHistory spans every visit for this patient, not just the currently-open one useVisit.ts already tracks). */
  patientId: string;
  fdi: string;
  surfaces: SurfaceMap | undefined;
  notes: string | undefined;
  /** Merges into the tooth's SurfaceMap — touches only this one surface. */
  onSurfaceStatusChange: (surface: Surface, status: ToothStatus) => void;
  /** REPLACES the tooth's whole SurfaceMap with { all: status } — clears any per-surface overrides, so the chart can't end up showing a stale surface finding that contradicts the just-picked whole-tooth status. */
  onWholeToothStatusChange: (status: ToothStatus) => void;
  onNotesChange: (notes: string) => void;
}

function formatSlovenianDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(d)}.${Number(m)}.${y}`;
}

type Target = Surface | 'all';

// Detail panel opened below the chart when a tooth is selected — CLAUDE.md's
// own "Interaction Design" spec. Render this with `key={fdi}` from the
// parent (PatientChart.tsx) so switching teeth remounts it fresh: no
// leftover open-picker state bleeding from one tooth to the next, no extra
// effect needed to reset it by hand.
export function ToothDetailPanel({
  patientId,
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
  // "Urejanje" (editing — the pre-existing content below, unchanged) is the
  // default tab, so nothing about this panel's default appearance changes
  // for anyone who doesn't explicitly switch to "Zgodovina" — per CLAUDE.md's
  // "Visit lifecycle" section ("Zgodovina zdravljenja," Monika's own name
  // for this tab).
  const [activeTab, setActiveTab] = useState<'urejanje' | 'zgodovina'>('urejanje');

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

      <div className="flex gap-1 border-b border-[var(--line,#ccd6d4)]">
        <button
          type="button"
          onClick={() => setActiveTab('urejanje')}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
            activeTab === 'urejanje'
              ? 'border-[var(--accent,#2e6e62)] text-[var(--accent,#2e6e62)]'
              : 'border-transparent text-[var(--ink-soft,#45524f)]'
          }`}
        >
          Urejanje
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('zgodovina')}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
            activeTab === 'zgodovina'
              ? 'border-[var(--accent,#2e6e62)] text-[var(--accent,#2e6e62)]'
              : 'border-transparent text-[var(--ink-soft,#45524f)]'
          }`}
        >
          Zgodovina
        </button>
      </div>

      {activeTab === 'urejanje' ? (
        <>
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
        </>
      ) : (
        <ToothHistoryTab patientId={patientId} fdi={fdi} />
      )}
    </div>
  );
}

// "Zgodovina zdravljenja" — per CLAUDE.md's "Visit lifecycle" section: every
// tooth_records row this tooth has ever had, across every one of this
// patient's visits (not just the currently-open one), newest first. A
// separate component (not inlined above) purely so useToothHistory — a real
// Supabase fetch — only ever runs while this tab is actually the one being
// looked at, not on every render of the always-mounted "Urejanje" tab.
function ToothHistoryTab({ patientId, fdi }: { patientId: string; fdi: string }) {
  const { entries, loading, error } = useToothHistory(patientId, fdi);

  if (loading) {
    return <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>;
  }
  if (error) {
    return <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju zgodovine: {error}</p>;
  }
  if (entries.length === 0) {
    return <p className="text-sm italic text-[var(--muted,#6f7c79)]">Za ta zob še ni zabeležene zgodovine.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry, i) => {
        const lines = describeToothRecord(entry, fdi);
        return (
          <li key={i} className="rounded-md bg-[#e7e7e7] p-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-[var(--muted,#6f7c79)]">{formatSlovenianDate(entry.date)}</span>
              {entry.closedAt === null && (
                <span className="text-xs font-semibold text-[var(--accent,#2e6e62)]">(trenutni obisk)</span>
              )}
            </div>
            {lines.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-0.5 text-sm text-[var(--ink,#1c2624)]">
                {lines.map((line, j) => (
                  <li key={j}>• {line}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm italic text-[var(--muted,#6f7c79)]">Brez zabeleženih sprememb.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
