/**
 * SCRIPTED REHEARSAL — drives the real Switchboard server through a full
 * negotiation at human pace, WITHOUT TrueForge or any model. For rehearsing
 * the demo and recording fallback footage of the operator view.
 *
 * Honesty rules, built in:
 *  - the room topic is prefixed "[SCRIPTED REHEARSAL]" and shows on every page
 *  - no TrueForge session, approval, or external action is real here
 *  - never present this as live agents; it exercises the same server code
 *    the live agents call, nothing more.
 *
 * Usage: npm run server   (in one terminal)
 *        npm run rehearse (in another; watch http://localhost:7400)
 */

const SWITCHBOARD_URL = process.env.SWITCHBOARD_URL ?? 'http://localhost:7400';

let rpcId = 0;
async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SWITCHBOARD_URL}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  const dataLine = text.split('\n').map((l) => l.trim()).find((l) => l.startsWith('data:'));
  const parsed = JSON.parse(dataLine ? dataLine.slice(5) : text);
  const content = parsed.result?.content?.[0]?.text;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

async function activity(agent: string, state: string, detail: string): Promise<void> {
  await fetch(`${SWITCHBOARD_URL}/activity`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent, state, detail }),
  }).catch(() => {});
}

const beat = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  try {
    await fetch(`${SWITCHBOARD_URL}/`);
  } catch {
    console.error(`[rehearse] no server at ${SWITCHBOARD_URL} — run \`npm run server\` first`);
    process.exit(1);
  }

  console.log('[rehearse] SCRIPTED REHEARSAL starting — watch', SWITCHBOARD_URL);

  const a = await call('create_room', {
    topic: '[SCRIPTED REHEARSAL] dinner for Abhinav & Priya this weekend',
    handle: 'agent-abhinav',
  });
  const roomId = a.room_id as string;
  console.log(`[rehearse] room: ${SWITCHBOARD_URL}/room/${roomId}`);
  await activity('agent-abhinav', 'negotiating', 'opening the room');
  await beat(2500);

  const b = await call('join_room', { room_id: roomId, handle: 'agent-priya' });
  await activity('agent-priya', 'negotiating', 'reading the wire');
  await beat(2500);

  await call('send_offer', {
    room_id: roomId, handle: 'agent-abhinav', line_token: a.line_token, kind: 'propose',
    body: { option: 'Nari (Thai)', time: 'tonight 19:15', price_pp: 45, reason: 'quiet, veg-friendly menu' },
  });
  await activity('agent-abhinav', 'waiting_reply', 'proposal on the wire');
  await beat(3500);

  await call('send_offer', {
    room_id: roomId, handle: 'agent-priya', line_token: b.line_token, kind: 'counter',
    body: { option: 'Nari (Thai)', time: 'tonight 19:45', price_pp: 45, reason: 'earliest my human can start' },
  });
  await activity('agent-priya', 'waiting_reply', 'countered on timing');
  await beat(3500);

  await call('send_offer', {
    room_id: roomId, handle: 'agent-abhinav', line_token: a.line_token, kind: 'accept',
    body: { option: 'Nari (Thai)', time: 'tonight 19:45', price_pp: 45 },
  });
  await beat(2500);

  await call('commit_deal', {
    room_id: roomId, handle: 'agent-abhinav', line_token: a.line_token,
    terms: 'Dinner at Nari, tonight 19:45, about $45 per person',
    starts_at: rehearsalStartsAt(), duration_minutes: 90, location: 'Nari, San Francisco',
  });
  await activity('agent-abhinav', 'waiting_reply', 'committed, waiting for counterpart');
  await activity('agent-priya', 'awaiting_human', 'commit_deal paused for approval');
  console.log('[rehearse] ⚠ gate moment — hold here for the camera (8s)');
  await beat(8000);

  await call('commit_deal', {
    room_id: roomId, handle: 'agent-priya', line_token: b.line_token,
    terms: 'Dinner at Nari, tonight 19:45, about $45 per person',
  });
  await activity('agent-abhinav', 'done', 'agreement sealed');
  await activity('agent-priya', 'done', 'agreement sealed');
  console.log(`[rehearse] sealed — receipt at ${SWITCHBOARD_URL}/room/${roomId} · calendar at /room/${roomId}/calendar.ics`);
}

/** Tonight 19:45 local time, as ISO with the machine's offset. */
function rehearsalStartsAt(): string {
  const d = new Date();
  d.setHours(19, 45, 0, 0);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${hh}:${mm}`;
}

main().catch((err) => {
  console.error('[rehearse] failed:', err);
  process.exit(1);
});
