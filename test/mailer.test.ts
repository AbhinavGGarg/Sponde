import { describe, expect, it } from 'vitest';
import { buildInviteIcs } from '../src/server/mailer.js';
import { RoomStore } from '../src/server/rooms.js';

function sealedRoom() {
  const store = new RoomStore();
  const a = store.createRoom('dinner with priya', 'agent-a');
  const b = store.joinRoom(a.room.id, 'agent-b');
  const event = { starts_at: '2026-08-29T19:45:00-07:00', duration_minutes: 90, location: 'Udupi Palace' };
  store.commit(a.room.id, 'agent-a', a.token, 'Dinner Sat 7:45pm at Udupi Palace, $40pp', event);
  store.commit(a.room.id, 'agent-b', b.token, 'Dinner Sat 7:45pm at Udupi Palace, $40pp', event);
  return store.get(a.room.id);
}

describe('seal-mail invite', () => {
  it('is a real METHOD:REQUEST invite with organizer and both attendees', () => {
    const ics = buildInviteIcs(sealedRoom(), 'host@example.com', ['a@example.com', 'b@example.com']);
    expect(ics).toBeDefined();
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).not.toContain('METHOD:PUBLISH');
    expect(ics).toContain('ORGANIZER;CN=Sponde:mailto:host@example.com');
    expect(ics).toContain('RSVP=TRUE:mailto:a@example.com');
    expect(ics).toContain('RSVP=TRUE:mailto:b@example.com');
  });

  it('keeps the dually-approved event details and the UID that makes retries idempotent', () => {
    const room = sealedRoom();
    const ics = buildInviteIcs(room, 'host@example.com', ['a@example.com']) as string;
    expect(ics).toContain(`UID:${room.id}@switchboard.local`);
    expect(ics).toContain('DTSTART:');
    expect(ics).toContain('DTEND:');
    expect(ics).toContain('LOCATION:Udupi Palace');
    expect(ics).toContain(room.seal?.sha256 as string);
  });

  it('never produces an invite for an unsealed room — same gate as the hold', () => {
    const store = new RoomStore();
    const a = store.createRoom('dinner', 'agent-a');
    const b = store.joinRoom(a.room.id, 'agent-b');
    store.commit(a.room.id, 'agent-a', a.token, 'terms agreed at last');
    expect(store.get(a.room.id).status).toBe('negotiating');
    expect(buildInviteIcs(store.get(a.room.id), 'host@example.com', ['a@example.com'])).toBeUndefined();
    void b;
  });
});
