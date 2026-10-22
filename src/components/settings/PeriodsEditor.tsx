import { describePeriods, minToTime, timeToMin, type Period } from '../../lib/workingHours';
import { TimeSelect } from '../ui/TimeSelect';

// One day's working periods ([od]–[do] ✕, "+ obdobje") — shared by a team
// member's hours (WorkingHoursDialog) and the clinic's (PracticeHoursSection).

const LINK_CLASS = 'text-xs font-medium text-[var(--accent,#2e6e62)] hover:underline disabled:opacity-50';
const DANGER_LINK_CLASS = 'text-xs font-medium text-[var(--danger,#b3261e)] hover:underline';

function overlaps(periods: Period[]): boolean {
  const sorted = [...periods].sort((a, b) => a.startMin - b.startMin);
  return sorted.some((p, i) => i > 0 && p.startMin < sorted[i - 1].endMin);
}

/** Validation message for one day's periods, or null. */
export function periodsError(periods: Period[]): string | null {
  if (periods.some((p) => p.endMin <= p.startMin)) return 'Konec mora biti po začetku.';
  if (overlaps(periods)) return 'Obdobja se prekrivajo.';
  return null;
}

/** Editable list of periods for one day: [od]–[do] ×, "+ obdobje". */
export function PeriodsEditor({ periods, onChange, readOnly }: { periods: Period[]; onChange: (next: Period[]) => void; readOnly: boolean }) {
  if (readOnly) return <span className="text-sm">{describePeriods(periods)}</span>;
  return (
    <div className="flex flex-col gap-1.5">
      {periods.length === 0 && <span className="text-sm text-[var(--muted,#6f7c79)]">ne dela</span>}
      {periods.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div>
            <TimeSelect
              label="Od"
              value={minToTime(p.startMin)}
              onChange={(v) => onChange(periods.map((q, j) => (j === i ? { ...q, startMin: timeToMin(v) } : q)))}
            />
          </div>
          <span>–</span>
          <div>
            <TimeSelect
              label="Do"
              value={minToTime(p.endMin)}
              onChange={(v) => onChange(periods.map((q, j) => (j === i ? { ...q, endMin: timeToMin(v) } : q)))}
            />
          </div>
          <button type="button" onClick={() => onChange(periods.filter((_, j) => j !== i))} className={DANGER_LINK_CLASS} aria-label="Odstrani obdobje">
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const last = periods[periods.length - 1];
          // A new period starts an hour after the previous one ends (a typical break).
          const start = last ? Math.min(last.endMin + 60, 23 * 60) : 8 * 60;
          onChange([...periods, { startMin: start, endMin: Math.min(start + 4 * 60, 23 * 60 + 55) }]);
        }}
        className={`${LINK_CLASS} self-start`}
      >
        + obdobje
      </button>
    </div>
  );
}
