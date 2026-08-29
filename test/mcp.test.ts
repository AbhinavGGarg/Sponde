import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { buildApp } from '../src/server/app.js';

/**
 * Protocol-level contract: the ONLY binding tools are annotated destructive
 * (so @destructive gating catches them) and the conversation tools are not —
 * plus a full negotiation driven end-to-end through real MCP tool calls.
 */

let server: Server;
let base: string;

const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

let rpcId = 0;
async function rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const text = await res.text();
  const dataLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  return JSON.parse(dataLine ? dataLine.slice(5) : text);
}

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await rpc('tools/call', { name, arguments: args });
  const text = res.result.content[0].text as string;
  try {
    return { isError: res.result.isError ?? false, data: JSON.parse(text) };
  } catch {
    return { isError: res.result.isError ?? false, data: text };
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

describe('switchboard MCP contract', () => {
  it('annotates exactly the binding tools as destructive', async () => {
    const res = await rpc('tools/list');
    const tools = new Map<string, { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }>(
      res.result.tools.map((t: { name: string }) => [t.name, t]),
    );
    expect([...tools.keys()].sort()).toEqual([
      'commit_deal',
      'create_room',
      'get_transcript',
      'join_room',
      'leave_room',
      'send_offer',
      'wait_for_reply',
    ]);
    for (const name of ['commit_deal', 'leave_room']) {
      expect(tools.get(name)?.annotations?.destructiveHint, `${name} must be destructive`).toBe(true);
    }
    for (const name of ['create_room', 'join_room', 'send_offer']) {
      expect(tools.get(name)?.annotations?.destructiveHint ?? false, `${name} must not be destructive`).toBe(false);
    }
    for (const name of ['wait_for_reply', 'get_transcript']) {
      expect(tools.get(name)?.annotations?.readOnlyHint, `${name} must be read-only`).toBe(true);
    }
  });

  it('runs a full negotiation over the wire: open, join, offer, counter, dual commit, seal', async () => {
    const a = await call('create_room', { topic: 'dinner this weekend', handle: 'agent-a' });
    expect(a.data.status).toBe('open');
    const roomId = a.data.room_id;

    const b = await call('join_room', { room_id: roomId, handle: 'agent-b' });
    expect(b.data.status).toBe('negotiating');

    await call('send_offer', {
      room_id: roomId,
      handle: 'agent-a',
      line_token: a.data.line_token,
      kind: 'propose',
      body: { option: 'Nari', time: '19:45', price_pp: 45 },
    });

    const replies = await call('wait_for_reply', {
      room_id: roomId,
      handle: 'agent-b',
      line_token: b.data.line_token,
      since_seq: 0,
    });
    expect(replies.data.replies).toHaveLength(1);
    expect(replies.data.replies[0].body.option).toBe('Nari');

    await call('send_offer', {
      room_id: roomId,
      handle: 'agent-b',
      line_token: b.data.line_token,
      kind: 'accept',
      body: { option: 'Nari', time: '19:45', price_pp: 45 },
    });

    const c1 = await call('commit_deal', {
      room_id: roomId,
      handle: 'agent-a',
      line_token: a.data.line_token,
      terms: 'Dinner at Nari, Saturday 19:45, about $45 per person',
    });
    expect(c1.data.status).toBe('negotiating');

    const c2 = await call('commit_deal', {
      room_id: roomId,
      handle: 'agent-b',
      line_token: b.data.line_token,
      terms: 'Dinner at Nari, Saturday 19:45, about $45 per person',
    });
    expect(c2.data.status).toBe('sealed');
    expect(c2.data.seal.sha256).toMatch(/^[0-9a-f]{64}$/);

    // The operator page renders the sealed room.
    const page = await (await fetch(`${base}/room/${roomId}`)).text();
    expect(page).toContain('DEAL SEALED');
    expect(page).toContain(c2.data.seal.sha256);
  });

  it('rejects a commit with a stolen/wrong token as an error result', async () => {
    const a = await call('create_room', { topic: 'test', handle: 'agent-a' });
    await call('join_room', { room_id: a.data.room_id, handle: 'agent-b' });
    const bad = await call('commit_deal', {
      room_id: a.data.room_id,
      handle: 'agent-b',
      line_token: 'not-the-real-token',
      terms: 'anything at all here',
    });
    expect(bad.isError).toBe(true);
  });
});
