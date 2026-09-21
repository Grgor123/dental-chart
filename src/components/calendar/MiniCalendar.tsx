import { useEffect, useState } from 'react';

interface MiniCalendarProps {
  selectedDateIso: string;
  onSelectDate: (dateIso: string) => void;
}

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function toDateIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildMonthCells(year: number, month1to12: number): Date[] {
  const firstOfMonth = new Date(year, month1to12 - 1, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = Monday
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - firstWeekday);

  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  return cells;
}

// The small month-picker calendar shown in the sidebar, below the
// Terapevti chips — a quick date navigator independent of the main
// Day/Week/Month view, matching the mockup exactly (own prev/next month
// arrows, today circled in accent color, click a day to jump the whole
// page to that date).
export function MiniCalendar({ selectedDateIso, onSelectDate }: MiniCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(`${selectedDateIso.slice(0, 7)}-01`);
  useEffect(() => {
    setVisibleMonth(`${selectedDateIso.slice(0, 7)}-01`);
  }, [selectedDateIso]);
  const [year, month] = visibleMonth.split('-').map(Number);
  const cells = buildMonthCells(year, month);
  const todayIso = toDateIso(new Date());

  function shiftMonth(delta: number) {
    const d = new Date(`${visibleMonth}T00:00:00`);
    d.setMonth(d.getMonth() + delta);
    setVisibleMonth(toDateIso(d));
  }

  const monthLabel = new Date(`${visibleMonth}T00:00:00`).toLocaleDateString('sl-SI', { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold capitalize text-[var(--ink,#1c2624)]">{monthLabel}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Prejšnji mesec"
            className="flex h-5 w-5 items-center justify-center text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Naslednji mesec"
            className="flex h-5 w-5 items-center justify-center text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
          >
            ›
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i} className="text-[10px] font-semibold text-[var(--muted,#6f7c79)]">
            {label}
          </span>
        ))}
        {cells.map((cellDate) => {
          const cellIso = toDateIso(cellDate);
          const inMonth = cellDate.getMonth() === month - 1;
          const isSelected = cellIso === selectedDateIso;
          const isToday = cellIso === todayIso;
          return (
            <button
              key={cellIso}
              type="button"
              onClick={() => onSelectDate(cellIso)}
              className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                isSelected
                  ? 'bg-[var(--accent,#2e6e62)] font-semibold text-white'
                  : isToday
                    ? 'font-semibold text-[var(--accent,#2e6e62)]'
                    : inMonth
                      ? 'text-[var(--ink,#1c2624)]'
                      : 'text-[var(--muted,#6f7c79)]'
              }`}
            >
              {cellDate.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
