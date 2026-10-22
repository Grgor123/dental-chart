import { SLOT_STEP_MINUTES } from '../../lib/nextFreeSlot';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTE_OPTIONS = Array.from({ length: 60 / SLOT_STEP_MINUTES }, (_, i) => String(i * SLOT_STEP_MINUTES).padStart(2, '0'));

// A time as hour + minute dropdowns in 5-minute steps (Gregor, 2026-10-22) —
// the browser's own time input offers every minute. A stored odd minute
// (e.g. an older appointment at 14:03) stays as an extra option. Value is
// "HH:MM". Used by the appointment window and Ekipa → Delovni čas.
export function TimeSelect({ value, onChange, label }: { value: string; onChange: (next: string) => void; label?: string }) {
  const [hour, minute] = value.split(':');
  const minutes = MINUTE_OPTIONS.includes(minute) ? MINUTE_OPTIONS : [...MINUTE_OPTIONS, minute].sort();
  // Fixed width: two digits plus the arrow, no wider (the field doesn't stretch).
  const selectClass = 'w-[3.5rem] flex-none rounded border border-[var(--line,#ccd6d4)] px-1.5 py-2 text-[var(--ink,#1c2624)]';
  return (
    <div className="flex items-center gap-1">
      <select aria-label={`${label ?? 'Ura'} — ure`} value={hour} onChange={(e) => onChange(`${e.target.value}:${minute}`)} className={selectClass}>
        {HOUR_OPTIONS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-[var(--ink,#1c2624)]">:</span>
      <select aria-label={`${label ?? 'Ura'} — minute`} value={minute} onChange={(e) => onChange(`${hour}:${e.target.value}`)} className={selectClass}>
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
