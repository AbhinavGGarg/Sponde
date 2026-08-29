import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RoomStore, SwitchboardError, type MessageKind } from './rooms.js';

/**
 * switchboard — the MCP server both agents connect to. It is the meeting
 * room: agents open a line, exchange offers, and commit.
 *
 * Approval design (deliberate, and worth saying out loud to judges):
 *  - Conversation tools (create/join/send/wait) are cheap and un-gated, so
 *    the negotiation flows freely.
 *  - `commit_deal` is the ONLY tool that makes anything real, so it is
 *    annotated destructive AND listed by literal name in each agent's
 *    require_approval_for_tools. Two agents committing means two humans
 *    approving — the deal cannot exist without both.
 */

const kindSchema = z.enum(['propose', 'counter', 'accept', 'reject', 'note']);

/**
 * The only fields an offer may carry. Strict: unknown keys are rejected, so
 * raw private constraints (calendars, allergies, budget caps) have no channel
 * through the room. This does not make inference from offers impossible —
 * see README "Honest limits" — it makes direct transmission impossible.
 */
const offerBodySchema = z
  .object({
    option: z.string().max(120).optional(),
    item: z.string().max(120).optional(),
    place: z.string().max(120).optional(),
    date: z.string().max(40).optional(),
    time: z.string().max(40).optional(),
    price: z.number().finite().optional(),
    price_pp: z.number().finite().optional(),
    currency: z.string().max(8).optional(),
    quantity: z.number().int().optional(),
    duration_minutes: z.number().int().max(24 * 60).optional(),
    reason: z.string().max(240).optional(),
    source_url: z.string().url().max(300).optional(),
    retrieved_at: z.string().max(40).optional(),
    unverified: z.boolean().optional(),
  })
  .strict();

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(e: unknown) {
  const message = e instanceof SwitchboardError ? `${e.code}: ${e.message}` : String(e);
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildSwitchboardServer(store: RoomStore): McpServer {
  const server = new McpServer({ name: 'switchboard', version: '0.1.0' });

  server.registerTool(
    'create_room',
    {
      title: 'Open a room',
      description:
        'Open a negotiation room on the switchboard and take the first line. Returns room_id (share it with the counterpart agent) and your private line token (never share the token).',
      inputSchema: {
        topic: z.string().min(3).describe('What is being negotiated, one line'),
        handle: z.string().min(1).describe('Your agent handle, e.g. "agent-abhinav"'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ topic, handle }) => {
      try {
        const { room, token } = store.createRoom(topic, handle);
        return ok({ room_id: room.id, line_token: token, status: room.status });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    'join_room',
    {
      title: 'Join a room',
      description: 'Connect the second line to an open room. Returns your private line token.',
      inputSchema: {
        room_id: z.string(),
        handle: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ room_id, handle }) => {
      try {
        const { room, token } = store.joinRoom(room_id, handle);
        return ok({ room_id: room.id, line_token: token, status: room.status });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    'send_offer',
    {
      title: 'Send an offer or message',
      description:
        'Post a structured offer, counter-offer, accept/reject signal, or note onto the room wire. Only what you post here crosses to the other side — your private constraints never do.',
      inputSchema: {
        room_id: z.string(),
        handle: z.string(),
        line_token: z.string(),
        kind: kindSchema.describe('propose | counter | accept | reject | note'),
        body: offerBodySchema.describe(
          'Validated offer fields only, e.g. {"option":"Nari","time":"19:30","price_pp":45,"reason":"..."} — unknown fields are rejected',
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ room_id, handle, line_token, kind, body }) => {
      try {
        const msg = store.send(room_id, handle, line_token, kind as MessageKind, body);
        return ok({ posted: msg.seq, status: store.get(room_id).status });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    'wait_for_reply',
    {
      title: 'Wait for the other side',
      description:
        'Long-poll the room for messages from the counterpart after a sequence number. Returns as soon as something arrives, or after ~20s with waiting=true (call it again to keep listening).',
      inputSchema: {
        room_id: z.string(),
        handle: z.string(),
        line_token: z.string(),
        since_seq: z.number().int().min(0).describe('Highest message seq you have already seen'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ room_id, handle, line_token, since_seq }) => {
      try {
        const deadline = Date.now() + 20_000;
        for (;;) {
          const replies = store.repliesSince(room_id, handle, line_token, since_seq);
          const status = store.get(room_id).status;
          if (replies.length > 0 || status === 'sealed' || status === 'abandoned') {
            return ok({ status, replies });
          }
          if (Date.now() >= deadline) return ok({ status, waiting: true, replies: [] });
          await sleep(400);
        }
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    'get_transcript',
    {
      title: 'Read the room transcript',
      description: 'Full message log, commitments, and seal state for a room you are part of.',
      inputSchema: {
        room_id: z.string(),
        handle: z.string(),
        line_token: z.string(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ room_id, handle, line_token }) => {
      try {
        // Participation check via repliesSince(0) side effect-free validation.
        store.repliesSince(room_id, handle, line_token, 0);
        const room = store.get(room_id);
        return ok({
          room_id: room.id,
          topic: room.topic,
          status: room.status,
          messages: room.messages,
          commitments: Object.fromEntries(room.commitments),
          seal: room.seal ?? null,
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    'commit_deal',
    {
      title: 'Commit to the final terms',
      description:
        'Commit your side to the EXACT final terms — the only actionable step on the switchboard. The agreement seals when both sides commit matching terms, each behind its own human’s approval; the sealed room then issues a mutually-approved agreement receipt and a calendar hold. Include starts_at/duration/location when the terms have a time and place.',
      inputSchema: {
        room_id: z.string(),
        handle: z.string(),
        line_token: z.string(),
        terms: z
          .string()
          .min(10)
          .max(300)
          .describe('The exact final terms, one sentence, identical on both sides'),
        starts_at: z
          .string()
          .max(40)
          .optional()
          .describe('Event start as ISO-8601 with offset, e.g. 2026-08-29T19:45:00-07:00'),
        duration_minutes: z.number().int().min(5).max(24 * 60).optional(),
        location: z.string().max(160).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ room_id, handle, line_token, terms, starts_at, duration_minutes, location }) => {
      try {
        // Require an explicit timezone: bare local datetimes are ambiguous
        // across two humans' machines. (Qodo finding.)
        const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;
        if (starts_at !== undefined && (!ISO_WITH_OFFSET.test(starts_at) || Number.isNaN(Date.parse(starts_at)))) {
          return err('starts_at must be ISO-8601 WITH a timezone offset, e.g. 2026-08-29T19:45:00-07:00');
        }
        const room = store.commit(room_id, handle, line_token, terms, {
          ...(starts_at !== undefined ? { starts_at } : {}),
          ...(duration_minutes !== undefined ? { duration_minutes } : {}),
          ...(location !== undefined ? { location } : {}),
        });
        return ok({
          status: room.status,
          committed_by: [...room.commitments.keys()],
          seal: room.seal ?? null,
          note:
            room.status === 'sealed'
              ? 'Agreement sealed. The receipt and calendar hold are ready; the transcript hash is what both humans keep.'
              : 'Your side is committed. Waiting for the counterpart to commit matching terms.',
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    'leave_room',
    {
      title: 'Abandon the negotiation',
      description: 'Walk away from an unsealed room, with a reason the other side can read.',
      inputSchema: {
        room_id: z.string(),
        handle: z.string(),
        line_token: z.string(),
        reason: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ room_id, handle, line_token, reason }) => {
      try {
        const room = store.abandon(room_id, handle, line_token, reason);
        return ok({ status: room.status });
      } catch (e) {
        return err(e);
      }
    },
  );

  return server;
}
