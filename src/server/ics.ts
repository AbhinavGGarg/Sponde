import type { Room } from './rooms.js';

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

/** Returns the .ics text for a sealed room, or undefined when not sealed. */
export function buildCalendarHold(room: Room): string | undefined {
  if (room.status !== 'sealed' || !room.seal) return undefined;

  const commitments = [...room.commitments.values()];
  const terms = commitments[0]?.terms ?? room.topic;
  // Only dually-approved metadata reaches the calendar hold: a field appears
  // in the event only when BOTH sides committed it (equality is enforced at
  // commit time). One-sided metadata falls back to an all-day hold.
  const [ma, mb] = commitments.map((c) => c.event);
  const event = ma && mb ? ma : undefined;

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
    const end = new Date(start.getTime() + (event.duration_minutes ?? 90) * 60_000);
    lines.push(`DTSTART:${toIcsUtc(start.toISOString())}`, `DTEND:${toIcsUtc(end.toISOString())}`);
  } else {
    // No structured time in the commitments: an all-day hold on the seal date.
    const day = room.seal.sealedAt.slice(0, 10).replace(/-/g, '');
    lines.push(`DTSTART;VALUE=DATE:${day}`);
  }
  if (event?.location) lines.push(`LOCATION:${icsEscape(event.location)}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
