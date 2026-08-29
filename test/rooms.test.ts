import { describe, expect, it } from 'vitest';
import { RoomStore, SwitchboardError, normalizeTerms } from '../src/server/rooms.js';

function connectedRoom() {
  const store = new RoomStore();
  const a = store.createRoom('dinner', 'agent-a');
  const b = store.joinRoom(a.room.id, 'agent-b');
  return { store, id: a.room.id, aTok: a.token, bTok: b.token };
}

describe('RoomStore', () => {
  it('moves open → negotiating when the second line connects', () => {
    const store = new RoomStore();
    const { room, token } = store.createRoom('dinner', 'agent-a');
    expect(room.status).toBe('open');
    expect(token).toHaveLength(24);
    store.joinRoom(room.id, 'agent-b');
    expect(store.get(room.id).status).toBe('negotiating');
  });

  it('rejects a third line and duplicate handles', () => {
    const { store, id } = connectedRoom();
    expect(() => store.joinRoom(id, 'agent-c')).toThrowError(SwitchboardError);
    expect(() => store.joinRoom(id, 'agent-a')).toThrowError(SwitchboardError);
  });

  it('rejects messages with a wrong token — line ownership is enforced', () => {
    const { store, id, bTok } = connectedRoom();
    expect(() => store.send(id, 'agent-a', bTok, 'propose', {})).toThrowError(/token/);
    expect(() => store.send(id, 'agent-x', bTok, 'propose', {})).toThrowError(/not on this line/);
  });

  it('repliesSince returns only counterpart messages after the sequence point', () => {
    const { store, id, aTok, bTok } = connectedRoom();
    store.send(id, 'agent-a', aTok, 'propose', { option: 'X' });
    store.send(id, 'agent-b', bTok, 'counter', { option: 'Y' });
    store.send(id, 'agent-a', aTok, 'counter', { option: 'Z' });
    const forA = store.repliesSince(id, 'agent-a', aTok, 0);
    expect(forA.map((m) => m.kind)).toEqual(['counter']);
    const forBLate = store.repliesSince(id, 'agent-b', bTok, 2);
    expect(forBLate.map((m) => m.body)).toEqual([{ option: 'Z' }]);
  });

  it('one commit does not seal; matching second commit seals with a transcript hash', () => {
    const { store, id, aTok, bTok } = connectedRoom();
    const afterA = store.commit(id, 'agent-a', aTok, 'Dinner at Nari, tonight 19:45, ~$45pp');
    expect(afterA.status).toBe('negotiating');
    expect(afterA.seal).toBeUndefined();
    const sealed = store.commit(id, 'agent-b', bTok, 'dinner at nari, tonight 19:45,  ~$45pp');
    expect(sealed.status).toBe('sealed');
    expect(sealed.seal?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mismatched terms throw and leave the room negotiating', () => {
    const { store, id, aTok, bTok } = connectedRoom();
    store.commit(id, 'agent-a', aTok, 'Dinner at Nari, tonight 19:45');
    expect(() => store.commit(id, 'agent-b', bTok, 'Dinner at Nari, tomorrow 20:30')).toThrowError(
      /terms do not match/,
    );
    expect(store.get(id).status).toBe('negotiating');
  });

  it('a sealed room accepts no further messages or commitments', () => {
    const { store, id, aTok, bTok } = connectedRoom();
    store.commit(id, 'agent-a', aTok, 'terms of the deal here');
    store.commit(id, 'agent-b', bTok, 'terms of the deal here');
    expect(() => store.send(id, 'agent-a', aTok, 'note', {})).toThrowError(/sealed/);
    expect(() => store.commit(id, 'agent-a', aTok, 'new terms entirely!')).toThrowError(/sealed/);
  });

  it('abandon closes an unsealed room but can never undo a sealed one', () => {
    const { store, id, aTok, bTok } = connectedRoom();
    store.commit(id, 'agent-a', aTok, 'terms of the deal here');
    store.commit(id, 'agent-b', bTok, 'terms of the deal here');
    const room = store.abandon(id, 'agent-a', aTok, 'changed my mind');
    expect(room.status).toBe('sealed');
  });

  it('normalizeTerms tolerates whitespace/case only', () => {
    expect(normalizeTerms('  Dinner   AT Nari ')).toBe('dinner at nari');
    expect(normalizeTerms('dinner at nari')).not.toBe(normalizeTerms('dinner at noon'));
  });
});
