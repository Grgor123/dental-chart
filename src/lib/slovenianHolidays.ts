// Slovenian work-free days ("dela prosti dnevi") for "Dodaj slovenske
// praznike" in Nastavitve → Delovni čas (Gregor, 2026-11-09). Source:
// https://www.gov.si/teme/drzavni-prazniki-in-dela-prosti-dnevi/ (last change
// 5. 11. 2026). Only the fixed-date work-free days, entered once as yearly
// entries — the movable ones (velika noč, binkošti) are left out, Gregor's
// choice. Holidays that are working days (dan Primoža Trubarja, dan Triglava,
// dan Rudolfa Maistra, dan znanosti …) aren't here either. Pure — no
// React/Supabase.
import type { ClosedDay } from './workingHours';

/** Fixed-date work-free days: [month-day from, month-day to, name]. */
const FIXED: [string, string, string][] = [
  ['01-01', '01-02', 'Novo leto'],
  ['02-08', '02-08', 'Prešernov dan'],
  ['04-27', '04-27', 'Dan upora proti okupatorju'],
  ['05-01', '05-02', 'Praznik dela'],
  ['06-25', '06-25', 'Dan državnosti'],
  ['08-15', '08-15', 'Marijino vnebovzetje'],
  ['10-31', '10-31', 'Dan reformacije'],
  ['11-01', '11-01', 'Dan spomina na mrtve'],
  ['12-25', '12-25', 'Božič'],
  ['12-26', '12-26', 'Dan samostojnosti in enotnosti'],
];

export type HolidayEntry = Omit<ClosedDay, 'id'>;

/** The fixed-date holidays as yearly entries, starting this year. Velika noč
 *  and binkošti move every year, so they're left out (Gregor, 2026-11-09). */
export function slovenianHolidayEntries(today: Date): HolidayEntry[] {
  const year = today.getFullYear();
  return FIXED.map(([from, to, note]) => ({
    dateFrom: `${year}-${from}`,
    dateTo: `${year}-${to}`,
    note,
    repeatYearly: true,
  }));
}

/** True if an equal entry is already there (same days, same yearly-ness). */
export function holidayAlreadyEntered(entry: HolidayEntry, existing: ClosedDay[]): boolean {
  return existing.some((c) =>
    entry.repeatYearly
      ? c.repeatYearly && c.dateFrom.slice(5) === entry.dateFrom.slice(5) && c.dateTo.slice(5) === entry.dateTo.slice(5)
      : !c.repeatYearly && c.dateFrom === entry.dateFrom && c.dateTo === entry.dateTo
  );
}
