// Free slots for online booking (Gregor, 2026-11-09) — pure, no Supabase.
// Works in Europe/Ljubljana wall-clock time (date + minutes from midnight),
// since the Edge runtime runs in UTC while working hours are local. The hours
// come from workingHours.ts — the same rules the calendar uses: a therapist's
// own hours cut to the clinic's, absences and closed days excluded.
import { bookableHours, type PracticeSchedule, type Schedule } from './workingHours.ts';

const TIME_ZONE = 'Europe/Ljubljana';

export interface LocalTime {
  date: string; // YYYY-MM-DD
  min: number; // minutes from midnight
}

/** An instant as seen on the Ljubljana clock. */
export function toLocal(ms: number): LocalTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = Number(get('hour')) % 24; // some runtimes render midnight as 24
  return { date: `${get('year')}-${get('month')}-${get('day')}`, min: hour * 60 + Number(get('minute')) };
}

/** The instant of a Ljubljana wall-clock time. */
export function fromLocal(t: LocalTime): Date {
  const [y, m, d] = t.date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, t.min);
  let ms = guess;
  // Two passes settle the offset also on DST-change days.
  for (let i = 0; i < 2; i++) {
    const seen = toLocal(ms);
    const [sy, sm, sd] = seen.date.split('-').map(Number);
    const seenUtc = Date.UTC(sy, sm - 1, sd, 0, seen.min);
    ms += guess - seenUtc;
  }
  return new Date(ms);
}

export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10); // a UTC date built from UTC parts — safe here
}

export interface TherapistInput {
  id: string;
  schedule: Schedule | undefined;
  /** Booked intervals (ms), cancelled/no-show already left out. */
  busy: { start: number; end: number }[];
}

export interface Slot {
  start: Date;
  /** Therapists free for the whole visit at this time, in preference order. */
  therapistIds: string[];
}

/** Every slot start on the step grid, from `earliestMs` to the end of
 *  `lastDate`, where one of the therapists has `durationMin` free inside
 *  their bookable hours. Therapists are given in preference order. */
export function onlineSlots(args: {
  therapists: TherapistInput[];
  practice: PracticeSchedule | undefined;
  durationMin: number;
  stepMin: number;
  earliestMs: number;
  lastDate: string;
}): Slot[] {
  const { therapists, practice, durationMin, stepMin, earliestMs, lastDate } = args;
  const durationMs = durationMin * 60000;
  const slots = new Map<number, string[]>();
  for (let date = toLocal(earliestMs).date; date <= lastDate; date = addDaysIso(date, 1)) {
    for (const t of therapists) {
      for (const period of bookableHours(t.schedule, date, practice).periods) {
        const first = Math.ceil(period.startMin / stepMin) * stepMin;
        for (let min = first; min + durationMin <= period.endMin; min += stepMin) {
          const start = fromLocal({ date, min }).getTime();
          if (start < earliestMs) continue;
          const end = start + durationMs;
          if (t.busy.some((b) => b.start < end && start < b.end)) continue;
          const list = slots.get(start) ?? [];
          if (!list.includes(t.id)) list.push(t.id);
          slots.set(start, list);
        }
      }
    }
  }
  return [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, ids]) => ({
      start: new Date(start),
      therapistIds: therapists.map((t) => t.id).filter((id) => ids.includes(id)),
    }));
}
