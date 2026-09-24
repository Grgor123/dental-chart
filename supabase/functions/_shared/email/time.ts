// Europe/Ljubljana wall-clock helpers for the hourly cron functions —
// pg_cron has no timezone awareness (14:00 Ljubljana is 12:00 UTC in summer
// and 13:00 in winter), so each function checks the local hour itself.
const TIME_ZONE = 'Europe/Ljubljana';

export function ljubljanaHour(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', hour12: false }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? -1);
  // Some runtimes render midnight as "24" with hour12: false.
  return hour === 24 ? 0 : hour;
}

/** "YYYY-MM-DD" of an instant as seen on the Ljubljana calendar. */
export function toLjubljanaYmd(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
