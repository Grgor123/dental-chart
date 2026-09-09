import type { ToothStatus } from '../../types/dental';
import { STATUS_STYLES, STATUS_ORDER } from '../../data/statusStyles';
import { StatusSwatch } from './StatusSwatch';

interface StatusPickerProps {
  /** Currently-set status, if any — highlighted in the grid. */
  value?: ToothStatus;
  onSelect: (status: ToothStatus) => void;
  /** Escape key, or any other "close without changing anything" trigger. */
  onDismiss?: () => void;
}

// Full flat grid over every ToothStatus (STATUS_ORDER, statusStyles.ts) —
// deliberately not a curated "quick tier": which ~6-8 statuses are common
// enough to deserve a shortcut is a clinical judgment call, not something to
// guess at. Ship the simple version, let real use (not speculation) drive
// any later curation. No internal open/closed state — ToothDetailPanel.tsx
// owns whether this is mounted at all, so every render here is "currently
// showing."
export function StatusPicker({ value, onSelect, onDismiss }: StatusPickerProps) {
  return (
    <div
      role="group"
      aria-label="Izberite status"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDismiss?.();
      }}
      className="flex flex-wrap gap-1.5 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-2.5"
    >
      {STATUS_ORDER.map((status) => {
        const active = status === value;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(status)}
            className="flex items-center gap-1.5 rounded border px-2 py-1.5 text-left text-xs"
            style={{
              borderColor: active ? 'var(--tooth-selected, #2e6e62)' : 'var(--line, #ccd6d4)',
              backgroundColor: active ? 'color-mix(in srgb, var(--tooth-selected, #2e6e62) 12%, transparent)' : 'transparent',
            }}
          >
            <StatusSwatch status={status} size={20} />
            <span className="text-[var(--ink,#1c2624)]">{STATUS_STYLES[status].label}</span>
          </button>
        );
      })}
    </div>
  );
}
