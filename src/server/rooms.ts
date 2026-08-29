import { createHash, randomBytes } from 'node:crypto';

/**
 * The Switchboard room model. Pure in-memory state, no I/O — every rule that
 * matters lives here so the tests can pin it down:
 *
 *  - Only offers cross the wire. Each side's private constraints stay in its
 *    own agent; the room never sees them.
 *  - A deal binds only when BOTH sides commit matching terms — and each
 *    side's commit_deal call is human-approval-gated by the harness.
 *  - Once sealed, a room is immutable and its transcript carries a SHA-256
 *    seal over every line.
 */

export type MessageKind = 'propose' | 'counter' | 'accept' | 'reject' | 'note';

export interface RoomMessage {
  seq: number;
  at: string;
  from: string;
  kind: MessageKind;
  /** Structured offer/counter body — free-form JSON the agents agree on. */
  body: unknown;
}

export interface EventMeta {
  starts_at?: string;
  duration_minutes?: number;
  location?: string;
}

export interface Commitment {
  at: string;
  terms: string;
  event?: EventMeta;
}

export type RoomStatus = 'open' | 'negotiating' | 'sealed' | 'abandoned';

export interface Room {
  id: string;
  topic: string;
  createdAt: string;
  status: RoomStatus;
  /** handle -> participant token (proof of line ownership). */
  participants: Map<string, string>;
  messages: RoomMessage[];
  commitments: Map<string, Commitment>;
  seal?: { sha256: string; sealedAt: string };
}

export class SwitchboardError extends Error {
  constructor(
    public readonly code:
      | 'room_not_found'
      | 'not_a_participant'
      | 'bad_token'
      | 'room_full'
      | 'room_closed'
      | 'handle_taken'
      | 'terms_mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'SwitchboardError';
  }
}

const MAX_PARTICIPANTS = 2;

/** Normalize terms so trivial whitespace/case differences don't block a deal. */
export function normalizeTerms(terms: string): string {
  return terms.toLowerCase().replace(/\s+/g, ' ').trim();
}

export class RoomStore {
  private rooms = new Map<string, Room>();

  constructor(private now: () => Date = () => new Date()) {}

  createRoom(topic: string, handle: string): { room: Room; token: string } {
    const id = `room_${randomBytes(4).toString('hex')}`;
    const token = randomBytes(12).toString('hex');
    const room: Room = {
      id,
      topic,
      createdAt: this.now().toISOString(),
      status: 'open',
      participants: new Map([[handle, token]]),
      messages: [],
      commitments: new Map(),
    };
    this.rooms.set(id, room);
    return { room, token };
  }

  joinRoom(roomId: string, handle: string): { room: Room; token: string } {
    const room = this.mustGet(roomId);
    if (room.status === 'sealed' || room.status === 'abandoned') {
      throw new SwitchboardError('room_closed', `room ${roomId} is ${room.status}`);
    }
    if (room.participants.has(handle)) {
      throw new SwitchboardError('handle_taken', `handle "${handle}" is already on this line`);
    }
    if (room.participants.size >= MAX_PARTICIPANTS) {
      throw new SwitchboardError('room_full', `room ${roomId} already has both lines connected`);
    }
    const token = randomBytes(12).toString('hex');
    room.participants.set(handle, token);
    if (room.participants.size === MAX_PARTICIPANTS) room.status = 'negotiating';
    return { room, token };
  }

  send(roomId: string, handle: string, token: string, kind: MessageKind, body: unknown): RoomMessage {
    const room = this.mustGet(roomId);
    this.mustBeParticipant(room, handle, token);
    if (room.status === 'sealed' || room.status === 'abandoned') {
      throw new SwitchboardError('room_closed', `room ${roomId} is ${room.status}; no further messages`);
    }
    const message: RoomMessage = {
      seq: room.messages.length + 1,
      at: this.now().toISOString(),
      from: handle,
      kind,
      body,
    };
    room.messages.push(message);
    return message;
  }

  /** Messages after `sinceSeq` that the caller did not author. */
  repliesSince(roomId: string, handle: string, token: string, sinceSeq: number): RoomMessage[] {
    const room = this.mustGet(roomId);
    this.mustBeParticipant(room, handle, token);
    return room.messages.filter((m) => m.seq > sinceSeq && m.from !== handle);
  }

  /**
   * One side commits to exact terms. The room seals only when both sides have
   * committed and their normalized terms match; mismatched terms throw and
   * leave the room negotiating.
   */
  commit(roomId: string, handle: string, token: string, terms: string, event?: EventMeta): Room {
    const room = this.mustGet(roomId);
    this.mustBeParticipant(room, handle, token);
    if (room.status === 'sealed' || room.status === 'abandoned') {
      throw new SwitchboardError('room_closed', `room ${roomId} is ${room.status}`);
    }

    const other = [...room.commitments.entries()].find(([h]) => h !== handle);
    if (other && normalizeTerms(other[1].terms) !== normalizeTerms(terms)) {
      throw new SwitchboardError(
        'terms_mismatch',
        `your terms do not match ${other[0]}'s committed terms — keep negotiating or restate them exactly`,
      );
    }
    // Calendar metadata is part of what each human approves, so it must match
    // too: when both sides supply a field, the values must agree. (Qodo
    // finding: metadata could otherwise bypass the matching-approval rule.)
    if (other?.[1].event && event) {
      const a = other[1].event;
      const mismatch =
        (a.starts_at && event.starts_at && Date.parse(a.starts_at) !== Date.parse(event.starts_at)) ||
        (a.duration_minutes !== undefined &&
          event.duration_minutes !== undefined &&
          a.duration_minutes !== event.duration_minutes) ||
        (a.location && event.location && normalizeTerms(a.location) !== normalizeTerms(event.location));
      if (mismatch) {
        throw new SwitchboardError(
          'terms_mismatch',
          `your calendar details (starts_at/duration/location) do not match ${other[0]}'s — restate them identically`,
        );
      }
    }

    room.commitments.set(handle, {
      at: this.now().toISOString(),
      terms,
      ...(event && Object.keys(event).length > 0 ? { event } : {}),
    });
    this.send(roomId, handle, token, 'note', { committed: true, terms });

    if (room.commitments.size === MAX_PARTICIPANTS) {
      room.status = 'sealed';
      room.seal = {
        sha256: this.transcriptHash(room),
        sealedAt: this.now().toISOString(),
      };
    }
    return room;
  }

  abandon(roomId: string, handle: string, token: string, reason: string): Room {
    const room = this.mustGet(roomId);
    this.mustBeParticipant(room, handle, token);
    if (room.status !== 'sealed') {
      room.status = 'abandoned';
      room.messages.push({
        seq: room.messages.length + 1,
        at: this.now().toISOString(),
        from: handle,
        kind: 'note',
        body: { abandoned: true, reason },
      });
    }
    return room;
  }

  get(roomId: string): Room {
    return this.mustGet(roomId);
  }

  list(): Room[] {
    return [...this.rooms.values()];
  }

  transcriptHash(room: Room): string {
    const canonical = JSON.stringify({
      id: room.id,
      topic: room.topic,
      messages: room.messages,
      commitments: [...room.commitments.entries()].sort(([a], [b]) => a.localeCompare(b)),
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  private mustGet(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new SwitchboardError('room_not_found', `no such room: ${roomId}`);
    return room;
  }

  private mustBeParticipant(room: Room, handle: string, token: string): void {
    const expected = room.participants.get(handle);
    if (!expected) throw new SwitchboardError('not_a_participant', `"${handle}" is not on this line`);
    if (expected !== token) throw new SwitchboardError('bad_token', 'line token does not match');
  }
}
