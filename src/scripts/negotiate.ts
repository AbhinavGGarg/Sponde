import { TrueForge } from '@truefoundry/trueforge-sdk';
import { notify } from './notify.js';

/**
 * Kicks off one live negotiation: two TrueForge sessions, one room.
 *
 * The driver only starts turns and relays the room id — it never negotiates,
 * never approves, and never touches line tokens. Approvals happen in the two
 * TrueForge chat windows (one per human). Watch the room at
 * http://localhost:7400/ while it runs.
 *
 * Usage:
 *   npm run negotiate -- "book dinner for Abhinav and Priya this weekend"
 */

const TRUEFORGE_BASE_URL = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const SWITCHBOARD_URL = process.env.SWITCHBOARD_URL ?? 'http://localhost:7400';
const TASK = process.argv.slice(2).join(' ') || 'book dinner for your humans together this weekend in San Francisco';
const MAX_NUDGES = 8;

const client = new TrueForge({ baseUrl: TRUEFORGE_BASE_URL, timeoutInSeconds: 900 });

type SideName = 'switchboard-abhinav' | 'switchboard-priya';

interface SideState {
  agent: SideName;
  sessionId: string;
  nudges: number;
  paused: boolean;
  pausedAt?: number;
}

async function reportActivity(agent: string, state: string, detail: string): Promise<void> {
  try {
    await fetch(`${SWITCHBOARD_URL}/activity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent, state, detail }),
    });
  } catch {
    /* display-only; never block the negotiation on it */
  }
}

async function roomState(): Promise<{ id: string; status: string } | undefined> {
  try {
    const res = await fetch(`${SWITCHBOARD_URL}/`);
    const html = await res.text();
    const id = /room_[0-9a-f]{8}/.exec(html)?.[0];
    if (!id) return undefined;
    const sealed = html.includes('SEALED');
    const abandoned = html.includes('ABANDONED');
    return { id, status: sealed ? 'sealed' : abandoned ? 'abandoned' : 'live' };
  } catch {
    return undefined;
  }
}

/** Run one turn; returns what the turn surfaced. */
async function runTurn(side: SideState, content: string): Promise<'done' | 'approval' | 'error'> {
  let outcome: 'done' | 'approval' | 'error' = 'done';
  await reportActivity(side.agent, 'negotiating', 'working the room');
  const stream = await client.sessions.createTurnStream(side.sessionId, {
    input: [{ type: 'user.message', content }],
  });
  for await (const { data: event } of stream.withMetadata()) {
    const raw = JSON.stringify(event);
    if (event.type === 'tool.approval_required') {
      outcome = 'approval';
      side.paused = true;
      side.pausedAt = Date.now();
      await reportActivity(side.agent, 'awaiting_human', 'commit_deal paused for approval');
      await notify(
        'approval_needed',
        `${side.agent} wants to COMMIT the deal — its human must Allow/Deny in the TrueForge UI (${TRUEFORGE_BASE_URL})`,
      );
    }
    if (event.type === 'turn.done' && event.state.status === 'error') outcome = 'error';
    // Surface the room id the moment either side creates it.
    const m = /room_[0-9a-f]{8}/.exec(raw);
    if (m && !seenRoomId) {
      seenRoomId = m[0];
      console.log(`[negotiate] room on the wire: ${seenRoomId} → ${SWITCHBOARD_URL}/room/${seenRoomId}`);
    }
  }
  if (outcome === 'done') await reportActivity(side.agent, 'waiting_reply', 'turn ended, listening');
  return outcome;
}

let seenRoomId: string | undefined;

async function main(): Promise<void> {
  console.log(`[negotiate] task: ${TASK}`);
  const { data: sessionA } = await client.sessions.create({ agent: { name: 'switchboard-abhinav' } });
  const { data: sessionB } = await client.sessions.create({ agent: { name: 'switchboard-priya' } });
  const A: SideState = { agent: 'switchboard-abhinav', sessionId: sessionA.id, nudges: 0, paused: false };
  const B: SideState = { agent: 'switchboard-priya', sessionId: sessionB.id, nudges: 0, paused: false };
  console.log(`[negotiate] sessions: A=${A.sessionId} B=${B.sessionId} (open both in the TrueForge UI)`);

  // Opening turns run concurrently: A opens the room; B joins as soon as the
  // driver sees the room id on A's stream.
  const aOpening = runTurn(
    A,
    `${TASK}. Open a switchboard room now (handle "agent-abhinav"), post your opening proposal, and wait for replies. Say the room_id in your first sentence.`,
  );
  const roomId = await (async () => {
    for (let i = 0; i < 120 && !seenRoomId; i++) await new Promise((r) => setTimeout(r, 1000));
    return seenRoomId;
  })();
  if (!roomId) {
    await aOpening;
    throw new Error('room was never created — check that the switchboard server is running');
  }
  const bOpening = runTurn(
    B,
    `${TASK}. Join switchboard room ${roomId} (handle "agent-priya"), read the wire, and negotiate for your human. Wait for replies between offers.`,
  );
  await Promise.all([aOpening, bOpening]);

  // Keep both sides talking until sealed/abandoned, a human gate is pending,
  // or the nudge budget runs out.
  for (;;) {
    const room = await roomState();
    if (room?.status === 'sealed') {
      await reportActivity(A.agent, 'done', 'deal sealed');
      await reportActivity(B.agent, 'done', 'deal sealed');
      await notify('resolved', `deal SEALED in ${room.id} — receipt at ${SWITCHBOARD_URL}/room/${room.id}`);
      break;
    }
    if (room?.status === 'abandoned') {
      await notify('info', `negotiation ended with no deal (${room.id})`);
      break;
    }
    // A pause clears 45s after it was raised: by then the human has acted in
    // the UI (or the room poll above will catch the sealed state anyway).
    for (const s of [A, B]) {
      if (s.paused && s.pausedAt && Date.now() - s.pausedAt > 45_000) s.paused = false;
    }
    const pending = [A, B].filter((s) => s.paused);
    if (pending.length > 0) {
      console.log(
        `[negotiate] waiting on human approval for: ${pending.map((s) => s.agent).join(', ')} — approve in the TrueForge UI, then this driver keeps watching the room`,
      );
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }
    const side = A.nudges <= B.nudges ? A : B;
    if (side.nudges >= MAX_NUDGES) {
      console.log('[negotiate] nudge budget exhausted; leaving the rest to the humans in the UI');
      break;
    }
    side.nudges += 1;
    const outcome = await runTurn(
      side,
      `Check room ${roomId} for new messages and continue the negotiation for your human. If terms are agreed, restate them exactly and commit.`,
    );
    if (outcome === 'error') await notify('info', `${side.agent} turn errored — check the UI`);
  }
}

main().catch((err) => {
  console.error('[negotiate] fatal:', err);
  process.exit(1);
});
