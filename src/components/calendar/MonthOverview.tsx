import type { AppointmentWithPatient } from '../../hooks/useAppointments';

interface MonthOverviewProps {
  /** Any date within the month to display — only its year/month are read. */
  monthDateIso: string;
  /** Every appointment within the visible month's range (any status). */
  appointments: AppointmentWithPatient[];
  onDayClick: (dateIso: string) => void;
  /** Same per-appointment therapist-color lookup Week view's own TimeGrid
      uses (Calendar.tsx's therapistColorById) — Month's small chips get a
      colored dot from it too, so a patient's therapist reads the same way
      in every view, not just Day/Week. Undefined/no match -> neutral grey. */
  resolveEventColor: (appointment: AppointmentWithPatient) => string | undefined;
}

const NEUTRAL_CHIP_COLOR = '#9CA3AF';

const WEEKDAY_LABELS = ['Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob', 'Ned'];
const MAX_CHIPS_PER_DAY = 3;

function toDateIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Monday-first grid spanning the full weeks that contain the visible
// month — always 42 cells (6 full weeks), including a few greyed-out
// leading/trailing days from adjacent months so every row is a complete
// 7-day strip.
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

// Lightweight, read-only month overview — day cells with counts/small
// chips, click a day to jump into Day view. No click-to-create or drag
// here, per the confirmed "lightweight" scope.
export function MonthOverview({ monthDateIso, appointments, onDayClick, resolveEventColor }: MonthOverviewProps) {
  const [year, month] = monthDateIso.split('-').map(Number);
  const cells = buildMonthCells(year, month);
  const todayIso = toDateIso(new Date());

  const appointmentsByDay = new Map<string, AppointmentWithPatient[]>();
  for (const appt of appointments) {
    const dayIso = appt.startsAt.slice(0, 10);
    const list = appointmentsByDay.get(dayIso) ?? [];
    list.push(appt);
    appointmentsByDay.set(dayIso, list);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)]">
      <div className="grid flex-none grid-cols-7 border-b border-[var(--line,#ccd6d4)]">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="p-2 text-center text-xs font-semibold text-[var(--ink-soft,#45524f)]">
            {label}
          </div>
        ))}
      </div>
      {/* Same fixed outer frame as Day/Week's own TimeGrid (h-full from
          Calendar.tsx's flex ancestor) — this grid scrolls internally
          rather than growing the page if 6 full-height (min-h-[86px])
          week rows don't all fit, so the frame's own footprint never
          changes across view switches. */}
      <div className="grid flex-1 grid-cols-7 grid-rows-6 overflow-y-auto">
        {cells.map((cellDate) => {
          const dateIso = toDateIso(cellDate);
          const inMonth = cellDate.getMonth() === month - 1;
          const dayAppointments = appointmentsByDay.get(dateIso) ?? [];
          const overflow = dayAppointments.length - MAX_CHIPS_PER_DAY;
          return (
            <button
              key={dateIso}
              type="button"
              onClick={() => onDayClick(dateIso)}
              className={`flex min-h-[86px] flex-col items-stretch gap-1 border-b border-r border-[var(--line,#ccd6d4)] p-1.5 text-left ${
                inMonth ? '' : 'bg-[var(--bg,#eef2f1)] text-[var(--muted,#6f7c79)]'
              }`}
            >
              <span
                className={`self-start rounded-full px-1.5 text-xs font-semibold ${
                  dateIso === todayIso ? 'bg-[var(--accent,#2e6e62)] text-white' : 'text-[var(--ink,#1c2624)]'
                }`}
              >
                {cellDate.getDate()}
              </span>
              <div className="flex flex-col gap-0.5">
                {dayAppointments.slice(0, MAX_CHIPS_PER_DAY).map((appt) => (
                  <span
                    key={appt.id}
                    className="flex items-center gap-1 truncate rounded bg-[var(--bg,#eef2f1)] px-1 text-[10px] text-[var(--ink,#1c2624)]"
                  >
                    <span
                      className="h-1.5 w-1.5 flex-none rounded-full"
                      style={{ backgroundColor: resolveEventColor(appt) ?? NEUTRAL_CHIP_COLOR }}
                    />
                    <span className="truncate">
                      {appt.patientLastName} {appt.patientFirstName}
                    </span>
                  </span>
                ))}
                {overflow > 0 && <span className="text-[10px] text-[var(--muted,#6f7c79)]">+{overflow} več</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
