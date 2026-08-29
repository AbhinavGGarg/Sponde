import { normalizeTerms, type EventMeta, type Room } from './rooms.js';

/**
 * The real external action after both approvals: a calendar hold generated
 * from the sealed agreement. Deterministic from room state — the same sealed
 * room always yields the same event (stable UID = room id), so retries and
 * repeated downloads can never create a second hold.
 */

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Field-wise intersection of both sides' committed event metadata. */
export function agreedEvent(a?: EventMeta, b?: EventMeta): EventMeta | undefined {
  if (!a || !b) return undefined;
  const e: EventMeta = {};
  if (a.starts_at && b.starts_at && Date.parse(a.starts_at) === Date.parse(b.starts_at)) {
    e.starts_at = a.starts_at;
  }
  if (a.duration_minutes !== undefined && a.duration_minutes === b.duration_minutes) {
    e.duration_minutes = a.duration_minutes;
  }
  if (a.location && b.location && normalizeTerms(a.location) === normalizeTerms(b.location)) {
    e.location = a.location;
  }
  return Object.keys(e).length > 0 ? e : undefined;
}

/** Returns the .ics text for a sealed room, or undefined when not sealed. */
export function buildCalendarHold(room: Room): string | undefined {
  if (room.status !== 'sealed' || !room.seal) return undefined;

  const commitments = [...room.commitments.values()];
  const terms = commitments[0]?.terms ?? room.topic;
  // Only dually-approved metadata reaches the calendar hold: FIELD-WISE
  // intersection — a field appears only when BOTH sides committed it with
  // equal values. Partial metadata one side added unilaterally is dropped.
  // (Qodo round 2, finding 1.)
  const [ma, mb] = commitments.map((c) => c.event);
  const event = agreedEvent(ma, mb);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//switchboard//agreement//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${room.id}@switchboard.local`,
    `DTSTAMP:${toIcsUtc(room.seal.sealedAt)}`,
    `SUMMARY:${icsEscape(room.topic)}`,
    `DESCRIPTION:${icsEscape(`Mutually approved agreement: ${terms} · transcript sha256 ${room.seal.sha256}`)}`,
  ];

  if (event?.starts_at && !Number.isNaN(Date.parse(event.starts_at))) {
    const start = new Date(event.starts_at);
    lines.push(`DTSTART:${toIcsUtc(start.toISOString())}`);
    // DTEND only when BOTH sides committed a duration — the server never
    // invents an end time nobody approved. (Qodo round 3.)
    if (event.duration_minutes !== undefined) {
      const end = new Date(start.getTime() + event.duration_minutes * 60_000);
      lines.push(`DTEND:${toIcsUtc(end.toISOString())}`);
    }
  } else {
    // No structured time in the commitments: an all-day hold on the seal date.
    const day = room.seal.sealedAt.slice(0, 10).replace(/-/g, '');
    lines.push(`DTSTART;VALUE=DATE:${day}`);
  }
  if (event?.location) lines.push(`LOCATION:${icsEscape(event.location)}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
