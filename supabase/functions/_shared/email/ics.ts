// Hand-rolled plain-text VCALENDAR/VEVENT builder — no library, matching
// this project's existing minimal-dependency approach elsewhere (e.g. the
// hand-traced SVG tooth profiles, no chart library). The .ics format is
// simple enough text that a small builder is less overhead than a
// dependency for it.
//
// Used only by send-appointment-confirmation-email — the reminder email
// doesn't attach one (the patient already has the original invite from the
// confirmation email; a fresh unrequested invite from a reminder is more
// likely to read as a NEW event to a calendar client than a nudge about an
// existing one).

export interface IcsEventInput {
  /** Stable id for this event across resends of the SAME appointment — the
      appointment's own id, so a future "resend on reschedule" (not built
      yet, see CLAUDE.md) would correctly UPDATE the existing calendar
      entry instead of creating a duplicate. */
  appointmentId: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  summary: string;
  location?: string;
  description?: string;
  organizerEmail: string;
  organizerName: string;
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
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dental charting//Appointment//SL',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:appointment-${input.appointmentId}@dental-charting`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(input.startsAt)}`,
    `DTEND:${toIcsUtc(input.endsAt)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    ...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
    ...(input.description ? [`DESCRIPTION:${escapeIcsText(input.description)}`] : []),
    `ORGANIZER;CN=${escapeIcsText(input.organizerName)}:mailto:${input.organizerEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
