import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { buildApp } from '../src/server/app.js';

/**
 * The go/no-go contract: the checks that must hold before this concept ships.
 * (Clean-clone start, live TrueForge sessions, and refresh-survival are
 * verified in the live rehearsal; everything below is pinned here.)
 */

let server: Server;
let base: string;

const HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
let rpcId = 100;

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  const dataLine = text.split('\n').map((l) => l.trim()).find((l) => l.startsWith('data:'));
  const parsed = JSON.parse(dataLine ? dataLine.slice(5) : text);
  if (parsed.error) return { isError: true, data: parsed.error };
  const content = parsed.result.content[0].text as string;
  try {
    return { isError: parsed.result.isError ?? false, data: JSON.parse(content) };
  } catch {
    return { isError: parsed.result.isError ?? false, data: content };
  }
}

beforeAll(async () => {
  const { app } = buildApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  if (address == null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

async function openRoom() {
  const a = await call('create_room', { topic: 'weekend dinner', handle: 'agent-a' });
  const b = await call('join_room', { room_id: a.data.room_id, handle: 'agent-b' });
  return { id: a.data.room_id as string, aTok: a.data.line_token as string, bTok: b.data.line_token as string };
}

describe('go/no-go: privacy channel is closed', () => {
  it('rejects offers carrying unknown fields (no side channel for raw constraints)', async () => {
    const { id, aTok } = await openRoom();
    const bad = await call('send_offer', {
      room_id: id,
      handle: 'agent-a',
      line_token: aTok,
      kind: 'propose',
      body: { option: 'Nari', shellfish_allergy: true },
    });
    expect(bad.isError).toBe(true);
    const transcript = await call('get_transcript', { room_id: id, handle: 'agent-a', line_token: aTok });
    expect(JSON.stringify(transcript.data.messages)).not.toContain('shellfish');
  });

  it('rejects oversized prose payloads', async () => {
    const { id, aTok } = await openRoom();
    const bad = await call('send_offer', {
      room_id: id,
      handle: 'agent-a',
      line_token: aTok,
      kind: 'note',
      body: { reason: 'x'.repeat(2000) },
    });
    expect(bad.isError).toBe(true);
  });

  it('a sealed transcript contains only allowlisted offer keys', async () => {
    const { id, aTok, bTok } = await openRoom();
    await call('send_offer', {
      room_id: id, handle: 'agent-a', line_token: aTok, kind: 'propose',
      body: { option: 'Nari', time: '19:45', price_pp: 45, source_url: 'https://example.com/nari', retrieved_at: '2026-08-29T10:00:00-07:00' },
    });
    await call('send_offer', { room_id: id, handle: 'agent-b', line_token: bTok, kind: 'accept', body: { option: 'Nari', time: '19:45' } });
    await call('commit_deal', { room_id: id, handle: 'agent-a', line_token: aTok, terms: 'Dinner at Nari, tonight 19:45, ~$45pp' });
    await call('commit_deal', { room_id: id, handle: 'agent-b', line_token: bTok, terms: 'Dinner at Nari, tonight 19:45, ~$45pp' });
    const t = await call('get_transcript', { room_id: id, handle: 'agent-a', line_token: aTok });
    const allowed = new Set([
      'option', 'item', 'place', 'date', 'time', 'price', 'price_pp', 'currency', 'quantity',
      'duration_minutes', 'reason', 'source_url', 'retrieved_at', 'unverified',
      // server-authored note bodies:
      'committed', 'terms', 'abandoned',
    ]);
    for (const msg of t.data.messages as { body: Record<string, unknown> }[]) {
      for (const key of Object.keys(msg.body)) {
        expect(allowed.has(key), `unexpected key in transcript: ${key}`).toBe(true);
      }
    }
  });
});

describe('go/no-go: the action happens exactly once', () => {
  it('no calendar hold before both approvals; a stable one after; retries cannot fork it', async () => {
    const { id, aTok, bTok } = await openRoom();

    expect((await fetch(`${base}/room/${id}/calendar.ics`)).status).toBe(404);

    await call('commit_deal', {
      room_id: id, handle: 'agent-a', line_token: aTok,
      terms: 'Dinner at Nari, tonight 19:45, ~$45pp',
      starts_at: '2026-08-29T19:45:00-07:00', duration_minutes: 90, location: 'Nari, San Francisco',
    });
    expect((await fetch(`${base}/room/${id}/calendar.ics`)).status).toBe(404); // one approval is not enough

    await call('commit_deal', {
      room_id: id, handle: 'agent-b', line_token: bTok,
      terms: 'Dinner at Nari, tonight 19:45, ~$45pp',
      starts_at: '2026-08-29T19:45:00-07:00', duration_minutes: 90, location: 'Nari, San Francisco',
    });

    const first = await (await fetch(`${base}/room/${id}/calendar.ics`)).text();
    expect(first).toContain('BEGIN:VEVENT');
    expect(first).toContain(`UID:${id}@switchboard.local`);
    expect(first).toContain('DTSTART:20260830T024500Z'); // 19:45 -07:00 in UTC
    expect(first).toContain('LOCATION:Nari\\, San Francisco');

    // A repeat commit cannot re-seal, and the hold is byte-identical on retry.
    const again = await call('commit_deal', {
      room_id: id, handle: 'agent-b', line_token: bTok, terms: 'Dinner at Nari, tonight 19:45, ~$45pp',
    });
    expect(again.isError).toBe(true);
    const second = await (await fetch(`${base}/room/${id}/calendar.ics`)).text();
    expect(second).toBe(first);
  });

  it('rejects an invalid starts_at instead of sealing garbage into the hold', async () => {
    const { id, aTok } = await openRoom();
    const bad = await call('commit_deal', {
      room_id: id, handle: 'agent-a', line_token: aTok,
      terms: 'Dinner somewhere at some point', starts_at: 'tonight-ish',
    });
    expect(bad.isError).toBe(true);
  });

  it('rejects a starts_at WITHOUT a timezone offset (Qodo #5)', async () => {
    const { id, aTok } = await openRoom();
    const bad = await call('commit_deal', {
      room_id: id, handle: 'agent-a', line_token: aTok,
      terms: 'Dinner somewhere at some point', starts_at: '2026-08-29T19:45:00',
    });
    expect(bad.isError).toBe(true);
  });

  it('mismatched calendar metadata blocks the seal (Qodo #1)', async () => {
    const { id, aTok, bTok } = await openRoom();
    await call('commit_deal', {
      room_id: id, handle: 'agent-a', line_token: aTok,
      terms: 'Dinner at Nari, tonight', starts_at: '2026-08-29T19:45:00-07:00',
    });
    const clash = await call('commit_deal', {
      room_id: id, handle: 'agent-b', line_token: bTok,
      terms: 'Dinner at Nari, tonight', starts_at: '2026-08-29T21:00:00-07:00',
    });
    expect(clash.isError).toBe(true);
    const status = (await (await fetch(`${base}/room/${id}/status`)).json()) as { status: string };
    expect(status.status).toBe('negotiating');
  });

  it('one-sided calendar metadata never reaches the hold (Qodo #1)', async () => {
    const { id, aTok, bTok } = await openRoom();
    await call('commit_deal', {
      room_id: id, handle: 'agent-a', line_token: aTok,
      terms: 'Dinner at Nari, sometime soon',
      starts_at: '2026-08-29T19:45:00-07:00', location: 'Somewhere Sneaky',
    });
    await call('commit_deal', {
      room_id: id, handle: 'agent-b', line_token: bTok,
      terms: 'Dinner at Nari, sometime soon',
    });
    const ics = await (await fetch(`${base}/room/${id}/calendar.ics`)).text();
    expect(ics).toContain('DTSTART;VALUE=DATE:'); // all-day fallback
    expect(ics).not.toContain('Somewhere Sneaky'); // un-approved metadata dropped
  });
});

describe('go/no-go: the operator surface is hardened', () => {
  it('room status endpoint reports by id (Qodo #2 driver fix)', async () => {
    const { id } = await openRoom();
    const status = await (await fetch(`${base}/room/${id}/status`)).json();
    expect(status).toEqual({ id, status: 'negotiating', sealed_at: null });
    expect((await fetch(`${base}/room/room_00000000/status`)).status).toBe(404);
  });

  it('activity endpoint validates state and caps lengths (Qodo #3)', async () => {
    const bad1 = await fetch(`${base}/activity`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'agent-a', state: 'hacked' }),
    });
    expect(bad1.status).toBe(400);
    const bad2 = await fetch(`${base}/activity`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'agent-a', state: 'idle', detail: 'x'.repeat(500) }),
    });
    expect(bad2.status).toBe(400);
  });

  it('activity detail is HTML-escaped in the room view (Qodo #3)', async () => {
    const { id } = await openRoom();
    await fetch(`${base}/activity`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'agent-a', state: 'negotiating', detail: '<script>alert(1)</script>' }),
    });
    const page = await (await fetch(`${base}/room/${id}`)).text();
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('&#60;script&#62;');
  });
});
