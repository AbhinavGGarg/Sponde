import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ActivityBoard, type AgentState } from './activity.js';
import { buildCalendarHold } from './ics.js';
import { RoomStore } from './rooms.js';
import { buildSwitchboardServer } from './tools.js';
import { renderIndexPage, renderRoomPage } from './viewer.js';

/**
 * One process, four surfaces (all loopback):
 *   POST /mcp        — the MCP endpoint both agents connect to (stateless
 *                      transport per request, shared in-memory room store)
 *   GET  /           — operator view: start a negotiation, watch the lines
 *   GET  /room/:id   — the room's live view: doing / waiting on / did,
 *                      with the approval gate shown BEFORE the irreversible step
 *   POST /activity   — driver-reported agent states (display only, never truth)
 *   POST /start      — start a negotiation from the page (spawns the driver)
 */
const howPage = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'how.html'), 'utf8');

export function buildApp(store: RoomStore = new RoomStore()): {
  app: Express;
  store: RoomStore;
  board: ActivityBoard;
} {
  const app = express();
  const board = new ActivityBoard();
  let driverRunning = false;
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.post('/mcp', async (req, res) => {
    const server = buildSwitchboardServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('[switchboard] mcp request failed:', e);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  const methodNotAllowed = (_req: express.Request, res: express.Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Stateless server; use POST /mcp.' },
      id: null,
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  app.get('/', (_req, res) => {
    res.type('html').send(renderIndexPage(store.list(), board, driverRunning));
  });

  app.get('/how', (_req, res) => {
    res.type('html').send(howPage);
  });

  // Vendored animation runtime — served locally so /how never depends on
  // venue Wi-Fi or a CDN.
  const gsapDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'gsap', 'dist');
  app.get('/vendor/gsap.min.js', (_req, res) => res.type('js').sendFile(join(gsapDist, 'gsap.min.js')));
  app.get('/vendor/ScrollTrigger.min.js', (_req, res) =>
    res.type('js').sendFile(join(gsapDist, 'ScrollTrigger.min.js')),
  );

  app.get('/room/:id', (req, res) => {
    try {
      res.type('html').send(renderRoomPage(store.get(req.params.id), board));
    } catch {
      res.status(404).type('html').send('<pre>no such room</pre>');
    }
  });

  app.get('/room/:id/calendar.ics', (req, res) => {
    try {
      const ics = buildCalendarHold(store.get(req.params.id));
      if (!ics) {
        res.status(404).type('text').send('calendar hold exists only after both humans approve');
        return;
      }
      res.type('text/calendar').setHeader('content-disposition', `attachment; filename="${req.params.id}.ics"`);
      res.send(ics);
    } catch {
      res.status(404).type('text').send('no such room');
    }
  });

  app.post('/activity', (req, res) => {
    const { agent, state, detail } = req.body as { agent?: string; state?: AgentState; detail?: string };
    if (!agent || !state) {
      res.status(400).json({ error: 'agent and state required' });
      return;
    }
    res.json(board.report(agent, state, detail ?? ''));
  });

  // "A stranger could pick it up and drive": one box, one button, the whole
  // negotiation starts. Spawns the driver script; loopback-only by binding.
  app.post('/start', (req, res) => {
    const task = String((req.body as { task?: string }).task ?? '').trim();
    if (!task) {
      res.status(400).type('html').send('<pre>tell the agents what to negotiate</pre>');
      return;
    }
    if (driverRunning) {
      res.redirect('/');
      return;
    }
    driverRunning = true;
    const child = spawn('npx', ['tsx', 'src/scripts/negotiate.ts', task], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', () => {
      driverRunning = false;
    });
    res.redirect('/');
  });

  return { app, store, board };
}
