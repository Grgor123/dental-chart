// "Nov termin" proposes the first free slot (Gregor, 2026-10-22). Pure, no
// React/Supabase — useNextFreeSlot() (hooks/useAppointments.ts) feeds it the
// therapist's booked intervals and the bookable hours (lib/workingHours.ts:
// the therapist's hours cut to the clinic's; Mon–Fri 08–19 while none are set).
import { bookableHours, toDateIso, type PracticeSchedule, type Schedule } from './workingHours';

export const SLOT_STEP_MINUTES = 5;
const SEARCH_DAYS = 60;

export interface BusyInterval {
  start: number; // ms
  end: number; // ms
}

function roundUpToStep(ms: number): number {
  const step = SLOT_STEP_MINUTES * 60000;
  return Math.ceil(ms / step) * step;
}

/** Earliest start ≥ `from` inside the working hours where `durationMinutes`
 *  fits between the busy intervals; null if none within SEARCH_DAYS. */
export function findNextFreeSlot(
  from: Date,
  durationMinutes: number,
  busy: BusyInterval[],
  schedule?: Schedule,
  practice?: PracticeSchedule,
  withTherapist = true
): Date | null {
  const duration = durationMinutes * 60000;
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  const fromMs = roundUpToStep(from.getTime());
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);

  for (let i = 0; i < SEARCH_DAYS; i++, day.setDate(day.getDate() + 1)) {
    for (const period of bookableHours(schedule, toDateIso(day), practice, withTherapist).periods) {
      const periodStart = new Date(day).setHours(0, period.startMin, 0, 0);
      const periodEnd = new Date(day).setHours(0, period.endMin, 0, 0);
      let cursor = Math.max(periodStart, fromMs);
      for (const b of sorted) {
        if (b.end <= cursor || b.start >= periodEnd) continue;
        if (cursor + duration <= b.start) return new Date(cursor);
        cursor = Math.max(cursor, roundUpToStep(b.end));
      }
      if (cursor + duration <= periodEnd) return new Date(cursor);
    }
  }
  return null;
}
