import { useEffect, useState } from 'react';
import { useAppointmentsForWeek } from '../../hooks/useAppointments';
import { ABSENCE_LABELS, bookableHours, timeToMin, toDateIso, type PracticeSchedule, type Schedule } from '../../lib/workingHours';
import { TimeGrid, type TimeGridColumn } from './TimeGrid';

// One therapist's week inside the patient record's booking window (Gregor,
// 2026-11-09): their working hours (the rest shaded), their appointments, and
// the appointment being booked as an outlined block. Clicking a free spot
// picks the date and time; the window's own date/time fields stay in sync.
// Without a therapist ("Nedodeljen"): unassigned appointments, clinic hours.

const WEEKDAYS = ['pon', 'tor', 'sre', 'čet', 'pet', 'sob', 'ned'];

function addDays(dateIso: string, delta: number): string {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toDateIso(d);
}

function startOfWeekIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateIso(d);
}

function shortDate(dateIso: string): string {
  const [, m, d] = dateIso.split('-');
  return `${Number(d)}. ${Number(m)}.`;
}

interface TherapistWeekPickerProps {
  therapistId: string | null;
  therapistColor?: string;
  schedule: Schedule | undefined;
  practice: PracticeSchedule;
  /** The appointment being booked/moved. */
  date: string;
  time: string;
  durationMinutes: number;
  label: string;
  /** Left out of the grid (it's shown as the outlined block instead). */
  editingAppointmentId: string | null;
  onPick: (dateIso: string, timeHHmm: string) => void;
}

export function TherapistWeekPicker({
  therapistId,
  therapistColor,
  schedule,
  practice,
  date,
  time,
  durationMinutes,
  label,
  editingAppointmentId,
  onPick,
}: TherapistWeekPickerProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeekIso(date || toDateIso(new Date())));
  const [notice, setNotice] = useState<string | null>(null);
  // Follow the chosen date (typed, picked or proposed) to its week.
  useEffect(() => {
    if (date) setWeekStart(startOfWeekIso(date));
  }, [date]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const { appointments } = useAppointmentsForWeek(weekStart);
  const today = toDateIso(new Date());
  const visible = appointments.filter(
    (a) =>
      a.id !== editingAppointmentId &&
      a.status !== 'cancelled' &&
      a.status !== 'no_show' &&
      (therapistId ? a.therapistId === therapistId : !a.therapistId)
  );

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hoursOf = (d: string) => bookableHours(schedule, d, practice, !!therapistId);
  const eventsOn = (d: string) => visible.filter((a) => toDateIso(new Date(a.startsAt)) === d);
  // Weekend columns only when something happens there.
  const shownDays = days.filter((d, i) => i < 5 || hoursOf(d).periods.length > 0 || eventsOn(d).length > 0 || d === date);

  const columns: TimeGridColumn[] = shownDays.map((d) => {
    const hours = hoursOf(d);
    const offLabel = hours.closed
      ? 'Zaprto'
      : hours.absence
        ? ABSENCE_LABELS[hours.absence.reason]
        : hours.periods.length === 0
          ? 'Ne dela'
          : undefined;
    const weekday = WEEKDAYS[(new Date(`${d}T00:00:00`).getDay() + 6) % 7];
    return {
      key: d,
      dateIso: d,
      label: (
        <span className={`text-xs font-semibold ${d === today ? 'text-[var(--accent,#2e6e62)]' : 'text-[var(--ink,#1c2624)]'}`}>
          {weekday} {shortDate(d)}
        </span>
      ),
      events: eventsOn(d),
      accentColor: therapistColor,
      workingPeriods: hours.periods,
      offLabel,
    };
  });

  const startMin = time ? timeToMin(time) : 0;
  const highlight = date && time ? { dateIso: date, startMin, endMin: startMin + durationMinutes, label, color: therapistColor } : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setWeekStart(startOfWeekIso(today))}
          className="rounded border border-[var(--line,#ccd6d4)] px-2.5 py-1 text-xs font-medium text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]"
        >
          Ta teden
        </button>
        <button
          type="button"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          className="rounded px-2 py-1 text-[var(--ink-soft,#45524f)] hover:bg-[#eef2f1]"
          aria-label="Prejšnji teden"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          className="rounded px-2 py-1 text-[var(--ink-soft,#45524f)] hover:bg-[#eef2f1]"
          aria-label="Naslednji teden"
        >
          ›
        </button>
        <span className="text-sm font-semibold text-[var(--ink,#1c2624)]">
          {shortDate(weekStart)} – {shortDate(addDays(weekStart, 6))}
        </span>
        <span className="ml-auto text-xs text-[var(--muted,#6f7c79)]">
          {notice ?? 'Kliknite prost čas v koledarju ali izberite uro levo.'}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <TimeGrid
          columns={columns}
          minColumnWidth={92}
          highlight={highlight}
          scrollToMinutes={Math.max(0, (date && time ? startMin : 8 * 60) - 60)}
          resolveEventColor={() => therapistColor}
          onSlotClick={(_key, dateIso, hhmm) => onPick(dateIso, hhmm)}
          onEventClick={() => setNotice('Ta čas je že zaseden.')}
          onPastSlotClick={() => setNotice('Za preteklost ni možno ustvariti termina.')}
        />
      </div>
    </div>
  );
}
