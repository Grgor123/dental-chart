// Hand-rolled plain-text VCALENDAR/VEVENT builder — no library, matching
// this project's existing minimal-dependency approach elsewhere (e.g. the
// hand-traced SVG tooth profiles, no chart library). The .ics format is
// simple enough text that a small builder is less overhead than a
// dependency for it.
//
// Attached to the confirmation, reschedule (same UID + a higher SEQUENCE, so
// the calendar client UPDATES the existing entry) and cancellation
// (METHOD:CANCEL, so it removes it) emails. Reminder/post-visit/recall
// don't attach one — the patient already has the invite, and a fresh
// unrequested one is more likely to read as a NEW event than a nudge.

export interface IcsEventInput {
  /** Stable id for this event across resends of the SAME appointment — the
      appointment's own id, so a reschedule/cancel email correctly UPDATES or
      removes the existing calendar entry instead of creating a duplicate. */
  appointmentId: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  summary: string;
  location?: string;
  description?: string;
  organizerEmail: string;
  organizerName: string;
  /** 'CANCEL' removes the existing calendar entry with this UID. Default 'REQUEST'. */
  method?: 'REQUEST' | 'CANCEL';
  /** Must increase for each update of the same event (RFC 5545) or calendar
      clients ignore it as stale. Callers pass a unix timestamp for
      reschedule/cancel; the original confirmation is 0. */
  sequence?: number;
}

function toIcsUtc(iso: string): string {
  // YYYYMMDDTHHMMSSZ — explicit UTC, so this reads correctly in any
  // calendar client regardless of its own timezone setting, rather than a
  // floating local time that would need a TZID block to be unambiguous.
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// RFC 5545 line folding: a content line longer than 75 octets is folded by
// inserting CRLF + a single leading space before the 76th octet, and so on.
// Simple char-count approximation (not true octet-counting for multi-byte
// UTF-8) — adequate here since summary/location text is short Slovene copy,
// not attacker-controlled or exotic-script content.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  let result = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length > 0) {
    result += '\r\n ' + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return result;
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function buildIcsEvent(input: IcsEventInput): string {
  const method = input.method ?? 'REQUEST';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dental charting//Appointment//SL',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:appointment-${input.appointmentId}@dental-charting`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(input.startsAt)}`,
    `DTEND:${toIcsUtc(input.endsAt)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    ...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
    ...(input.description ? [`DESCRIPTION:${escapeIcsText(input.description)}`] : []),
    `ORGANIZER;CN=${escapeIcsText(input.organizerName)}:mailto:${input.organizerEmail}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
