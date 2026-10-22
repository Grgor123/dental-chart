// Working hours per team member (migration 047) and of the clinic (048) —
// pure, no React/Supabase. A therapist's date: clinic closed → none; an
// absence → none; else that date's own periods (a manual edit for one day)
// if any; else the weekly template for its weekday — per odd/even ISO week
// when the therapist works alternating weeks. A therapist with no weekly
// template gets the clinic's hours, or — none set either — Mon–Fri 08–19.
// What can actually be booked (bookableHours) is a therapist's hours cut to
// the clinic's.

export interface Period {
  startMin: number; // minutes from midnight
  endMin: number;
}

export type WeekParity = 'all' | 'odd' | 'even';
export type AbsenceReason = 'dopust' | 'bolniska' | 'izobrazevanje' | 'drugo';

export const ABSENCE_LABELS: Record<AbsenceReason, string> = {
  dopust: 'Dopust',
  bolniska: 'Bolniška',
  izobrazevanje: 'Izobraževanje',
  drugo: 'Odsotnost',
};

export interface WeeklyPeriod extends Period {
  id?: string;
  weekParity: WeekParity;
  weekday: number; // 1 = Monday … 7 = Sunday (ISO)
}

export interface DayPeriod extends Period {
  id: string;
  date: string; // YYYY-MM-DD
  note: string | null;
}

export interface Absence {
  id: string;
  dateFrom: string;
  dateTo: string;
  reason: AbsenceReason;
  note: string | null;
}

/** The clinic's own hours (migration 048). Empty `weekly` = not set. */
export interface PracticeSchedule {
  weekly: { weekday: number; startMin: number; endMin: number }[];
  closed: ClosedDay[];
  blockOutsideHours: boolean;
}

export interface ClosedDay {
  id: string;
  dateFrom: string;
  dateTo: string;
  note: string | null;
}

export interface Schedule {
  alternatingWeeks: boolean;
  weekly: WeeklyPeriod[];
  days: DayPeriod[];
  absences: Absence[];
}

/** Assumed until a therapist's weekly hours are set: Mon–Fri 08:00–19:00. */
export const DEFAULT_START_MIN = 8 * 60;
export const DEFAULT_END_MIN = 19 * 60;
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

export const WEEKDAY_LABELS = ['Ponedeljek', 'Torek', 'Sreda', 'Četrtek', 'Petek', 'Sobota', 'Nedelja'];

export function timeToMin(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

export function minToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Local date from 'YYYY-MM-DD' (never via UTC — see CLAUDE.md's timezone note). */
function parseDate(dateIso: string): Date {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toDateIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO 8601 week number. */
export function isoWeek(dateIso: string): number {
  const d = parseDate(dateIso);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day + 3); // Thursday of this week
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

export function weekParity(dateIso: string): 'odd' | 'even' {
  return isoWeek(dateIso) % 2 === 1 ? 'odd' : 'even';
}

export interface DayHours {
  periods: Period[];
  /** Where they came from — 'default' = the therapist has no weekly hours
   *  (clinic hours or Mon–Fri 08–19 apply); 'practice' = the clinic's own. */
  source: 'closed' | 'absence' | 'day' | 'weekly' | 'default' | 'practice';
  absence?: Absence;
  closed?: ClosedDay;
}

function weekdayOf(dateIso: string): number {
  return ((parseDate(dateIso).getDay() + 6) % 7) + 1;
}

/** The clinic's hours on a date; Mon–Fri 08–19 while none are set. */
export function practiceHoursForDate(practice: PracticeSchedule | undefined, dateIso: string): DayHours {
  const closed = practice?.closed.find((c) => c.dateFrom <= dateIso && dateIso <= c.dateTo);
  if (closed) return { periods: [], source: 'closed', closed };
  const weekday = weekdayOf(dateIso);
  if (!practice || practice.weekly.length === 0) {
    return {
      periods: DEFAULT_WEEKDAYS.includes(weekday) ? [{ startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN }] : [],
      source: 'default',
    };
  }
  return { periods: sortPeriods(practice.weekly.filter((w) => w.weekday === weekday)), source: 'practice' };
}

/** A therapist's own hours on a date (see the file comment). */
export function hoursForDate(schedule: Schedule | undefined, dateIso: string, practice?: PracticeSchedule): DayHours {
  const closed = practice?.closed.find((c) => c.dateFrom <= dateIso && dateIso <= c.dateTo);
  if (closed) return { periods: [], source: 'closed', closed };
  const absence = schedule?.absences.find((a) => a.dateFrom <= dateIso && dateIso <= a.dateTo);
  if (absence) return { periods: [], source: 'absence', absence };
  const own = schedule?.days.filter((d) => d.date === dateIso) ?? [];
  if (own.length > 0) return { periods: sortPeriods(own), source: 'day' };
  const weekday = weekdayOf(dateIso);
  if (!schedule || schedule.weekly.length === 0) {
    return { periods: practiceHoursForDate(practice, dateIso).periods, source: 'default' };
  }
  const parity: WeekParity = schedule.alternatingWeeks ? weekParity(dateIso) : 'all';
  return {
    periods: sortPeriods(schedule.weekly.filter((w) => w.weekday === weekday && w.weekParity === parity)),
    source: 'weekly',
  };
}

function sortPeriods(periods: Period[]): Period[] {
  return periods.map((p) => ({ startMin: p.startMin, endMin: p.endMin })).sort((a, b) => a.startMin - b.startMin);
}

/** What can be booked with a therapist: their hours cut to the clinic's
 *  (once the clinic has hours set). Without a therapist, the clinic's hours. */
export function bookableHours(schedule: Schedule | undefined, dateIso: string, practice?: PracticeSchedule, withTherapist = true): DayHours {
  const clinic = practiceHoursForDate(practice, dateIso);
  if (!withTherapist) return clinic;
  const own = hoursForDate(schedule, dateIso, practice);
  if (clinic.source !== 'practice') return own;
  return { ...own, periods: overlapPeriods(own.periods, clinic.periods) };
}

/** True if [startMin, endMin) lies inside one of the periods. */
export function fitsInPeriods(periods: Period[], startMin: number, endMin: number): boolean {
  return periods.some((p) => p.startMin <= startMin && endMin <= p.endMin);
}

/** "08:00–12:00, 13:00–17:00" or "ne dela". */
export function describePeriods(periods: Period[]): string {
  return periods.length === 0 ? 'ne dela' : periods.map((p) => `${minToTime(p.startMin)}–${minToTime(p.endMin)}`).join(', ');
}

// ---- Shared rooms (Gregor, 2026-10-22): team members assigned the same
// ordinacija must not have overlapping hours. Checked on saving hours
// (WorkingHoursDialog) and shown in the Ekipa table.

const WEEKDAY_SHORT = ['pon', 'tor', 'sre', 'čet', 'pet', 'sob', 'ned'];
const CONFLICT_HORIZON_DAYS = 56; // 8 weeks — both odd and even weeks, several times

export interface Conflict {
  date: string;
  periods: Period[];
}

/** The parts where two days' periods overlap. */
export function overlapPeriods(a: Period[], b: Period[]): Period[] {
  const out: Period[] = [];
  for (const p of a) {
    for (const q of b) {
      const startMin = Math.max(p.startMin, q.startMin);
      const endMin = Math.min(p.endMin, q.endMin);
      if (endMin > startMin) out.push({ startMin, endMin });
    }
  }
  return out.sort((x, y) => x.startMin - y.startMin);
}

/** Dates (from `fromIso`, 8 weeks, plus every later special day of either)
 *  on which both work at the same time. A schedule without weekly hours is
 *  only the assumed default, so it never counts as a clash. */
export function scheduleConflicts(a: Schedule | undefined, b: Schedule | undefined, fromIso: string): Conflict[] {
  if (!a || !b || a.weekly.length === 0 || b.weekly.length === 0) return [];
  const dates = new Set<string>();
  const start = parseDate(fromIso);
  for (let i = 0; i < CONFLICT_HORIZON_DAYS; i++) {
    dates.add(toDateIso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  }
  [...a.days, ...b.days].filter((d) => d.date >= fromIso).forEach((d) => dates.add(d.date));
  const conflicts: Conflict[] = [];
  for (const date of [...dates].sort()) {
    const periods = overlapPeriods(hoursForDate(a, date).periods, hoursForDate(b, date).periods);
    if (periods.length > 0) conflicts.push({ date, periods });
  }
  return conflicts;
}

/** "čet 29. 10. 12:00–14:00" */
export function describeConflict(c: Conflict): string {
  const d = parseDate(c.date);
  return `${WEEKDAY_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()}. ${d.getMonth() + 1}. ${describePeriods(c.periods)}`;
}
