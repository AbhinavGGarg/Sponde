import nodemailer from 'nodemailer';
import { buildCalendarHold } from './ics.js';
import type { Room, RoomStore } from './rooms.js';

/**
 * The real-world completion of a sealed deal: a genuine calendar INVITE
 * (iCalendar METHOD:REQUEST) emailed to both humans the moment the room
 * seals — mail clients render it as an actual event with Add-to-calendar,
 * so the agreement lands on both calendars without anyone downloading a
 * file. Exactly once per room, and only after BOTH approval gates.
 *
 * Opt-in by env (the switchboard itself stays credential-free unless the
 * operator provides these):
 *   GMAIL_USER          sending Gmail address (also the invite organizer)
 *   GMAIL_APP_PASSWORD  Gmail app password (never the account password)
 *   SEAL_EMAIL_TO       comma-separated recipients (default: GMAIL_USER)
 */

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const RECIPIENTS = (process.env.SEAL_EMAIL_TO ?? GMAIL_USER ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function sealMailEnabled(): boolean {
  return Boolean(GMAIL_USER && GMAIL_APP_PASSWORD && RECIPIENTS.length > 0);
}

/**
 * The sealed room's calendar hold, upgraded from a passive PUBLISH to a real
 * invite: METHOD:REQUEST plus ORGANIZER/ATTENDEE lines, which is what makes
 * mail clients offer Accept/Decline and auto-place the event. Undefined
 * unless the room is sealed — same rule as the hold itself.
 */
export function buildInviteIcs(room: Room, organizer: string, attendees: string[]): string | undefined {
  const hold = buildCalendarHold(room);
  if (!hold) return undefined;
  const extra = [
    `ORGANIZER;CN=Sponde:mailto:${organizer}`,
    ...attendees.map((a) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a}`),
  ];
  return hold
    .replace('METHOD:PUBLISH', 'METHOD:REQUEST')
    .replace(/^(UID:[^\r\n]*)/m, (_full, uidLine: string) => [uidLine, ...extra].join('\r\n'));
}

export async function sendSealInvite(room: Room): Promise<void> {
  if (!sealMailEnabled()) return;
  const ics = buildInviteIcs(room, GMAIL_USER as string, RECIPIENTS);
  if (!ics) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  const terms = [...room.commitments.values()][0]?.terms ?? room.topic;
  await transporter.sendMail({
    from: `"Sponde" <${GMAIL_USER}>`,
    to: RECIPIENTS.join(', '),
    subject: `Sealed: ${room.topic}`,
    text: [
      'Both humans approved identical terms — the deal is sealed.',
      '',
      terms,
      '',
      `Transcript sha256: ${room.seal?.sha256 ?? ''}`,
      `Room: ${room.id}`,
    ].join('\n'),
    icalEvent: { method: 'REQUEST', content: ics },
  });
}

/**
 * Watches the store and emails each room's invite exactly once when it
 * seals. Display/side-effect layer only — the room state machine stays
 * pure and fully tested. A room is marked before sending so a failed send
 * is logged, never retried into a double-invite.
 */
export function startSealWatcher(store: RoomStore, intervalMs = 2000): NodeJS.Timeout {
  const sent = new Set<string>();
  const timer = setInterval(() => {
    for (const room of store.list()) {
      if (room.status !== 'sealed' || sent.has(room.id)) continue;
      sent.add(room.id);
      void sendSealInvite(room)
        .then(() => console.log(`[seal-mail] calendar invite sent for ${room.id} → ${RECIPIENTS.join(', ')}`))
        .catch((e) => console.error(`[seal-mail] send failed for ${room.id} (will not retry):`, e));
    }
  }, intervalMs);
  timer.unref();
  return timer;
}
