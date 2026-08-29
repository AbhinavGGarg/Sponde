import { TrueForge } from '@truefoundry/trueforge-sdk';

/**
 * Pre-flight for the live demo: checks every moving part and prints the exact
 * fix for whatever is missing. Run before the first negotiation and before
 * going on stage.
 *
 *   npm run doctor
 */

const TRUEFORGE_BASE_URL = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const SWITCHBOARD_URL = process.env.SWITCHBOARD_URL ?? 'http://localhost:7400';
const MODEL_FQN = process.env.MODEL_FQN;
const BRIGHTDATA = process.env.BRIGHTDATA_CONNECTOR;

const EXPECTED_TOOLS = [
  'commit_deal',
  'create_room',
  'get_transcript',
  'join_room',
  'leave_room',
  'send_offer',
  'wait_for_reply',
];

let failures = 0;

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}
function bad(msg: string, fix: string): void {
  failures += 1;
  console.log(`  ✗ ${msg}`);
  console.log(`      fix → ${fix}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

async function main(): Promise<void> {
  section('node');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if ((major ?? 0) > 22 || ((major ?? 0) === 22 && (minor ?? 0) >= 14)) {
    ok(`node ${process.versions.node}`);
  } else {
    bad(`node ${process.versions.node} is too old`, 'install Node 22.14+ (nvm install 22)');
  }

  section('switchboard server');
  try {
    const res = await fetch(`${SWITCHBOARD_URL}/`);
    if (!res.ok) throw new Error(String(res.status));
    ok(`operator view up at ${SWITCHBOARD_URL}`);
  } catch {
    bad(`no server at ${SWITCHBOARD_URL}`, 'run `npm run server` in another terminal');
  }
  try {
    const res = await fetch(`${SWITCHBOARD_URL}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const text = await res.text();
    const dataLine = text.split('\n').map((l) => l.trim()).find((l) => l.startsWith('data:'));
    const parsed = JSON.parse(dataLine ? dataLine.slice(5) : text);
    const names = (parsed.result?.tools ?? []).map((t: { name: string }) => t.name).sort();
    if (JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS)) {
      ok(`room MCP endpoint serves all ${EXPECTED_TOOLS.length} tools`);
    } else {
      bad(`room MCP endpoint tools mismatch: ${names.join(', ') || 'none'}`, 'restart `npm run server` from this repo');
    }
  } catch {
    bad('room MCP endpoint not answering', 'run `npm run server`, then re-run doctor');
  }

  section('trueforge');
  const client = new TrueForge({ baseUrl: TRUEFORGE_BASE_URL });
  let trueforgeUp = false;
  let modelNames: string[] = [];
  try {
    const { data: models } = await client.models.list();
    trueforgeUp = true;
    modelNames = models.map((m) => m.name);
    ok(`trueforge up at ${TRUEFORGE_BASE_URL}`);
    if (modelNames.length === 0) {
      bad('no model provider configured', 'TrueForge → Settings → Models → configure a provider (use the OpenAI credits)');
    } else if (MODEL_FQN && !modelNames.includes(MODEL_FQN)) {
      bad(`MODEL_FQN=${MODEL_FQN} not among configured models`, `use one of: ${modelNames.slice(0, 5).join(', ')}`);
    } else {
      ok(`models configured: ${modelNames.slice(0, 3).join(', ')}${modelNames.length > 3 ? ', …' : ''}`);
    }
  } catch {
    bad(`cannot reach TrueForge at ${TRUEFORGE_BASE_URL}`, 'run `npx @truefoundry/trueforge@latest` and open http://localhost:8790');
  }

  if (trueforgeUp) {
    section('connector (trueforge → room)');
    try {
      const { data: servers } = await client.mcpServers.list();
      const sb = servers.find((s) => s.name === 'switchboard');
      if (!sb) {
        bad('connector "switchboard" not registered', `TrueForge → Settings → Connectors → Add MCP Server → name "switchboard", URL ${SWITCHBOARD_URL}/mcp`);
      } else {
        ok(`connector registered → ${sb.url}`);
        try {
          const { data: tools } = await client.mcpServers.listTools('switchboard');
          const names = tools.map((t) => String((t as { name?: unknown }).name ?? '')).sort();
          if (JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS)) {
            ok('trueforge can reach the room and sees all 7 tools');
          } else {
            bad(`trueforge sees wrong tools: ${names.join(', ') || 'none'}`, 'check the connector URL points at THIS server, then re-add it');
          }
        } catch {
          bad('trueforge cannot call the room', `connector URL must be ${SWITCHBOARD_URL}/mcp and \`npm run server\` must be running`);
        }
      }
      if (BRIGHTDATA) {
        const bd = servers.find((s) => s.name === BRIGHTDATA);
        if (bd) ok(`bright data connector "${BRIGHTDATA}" registered`);
        else bad(`BRIGHTDATA_CONNECTOR=${BRIGHTDATA} not found in TrueForge`, 'register it in Settings → Connectors or unset the env var');
      }
    } catch {
      bad('could not list connectors', 'check TrueForge version / restart it');
    }

    section('agents');
    try {
      const { data: agents } = await client.agents.list();
      for (const name of ['switchboard-abhinav', 'switchboard-priya']) {
        const agent = agents.find((a) => a.name === name);
        if (!agent) {
          bad(`agent "${name}" not seeded`, 'run `npm run seed-agents` (set MODEL_FQN first)');
          continue;
        }
        const sb = agent.manifest.mcpServers?.find((s) => s.name === 'switchboard');
        const approvals = (sb?.requireApprovalForTools ?? []).map(String);
        if (sb && approvals.includes('commit_deal') && approvals.includes('@destructive')) {
          ok(`${name}: seeded, commit_deal gated by name + @destructive (model ${agent.manifest.model.name})`);
        } else {
          bad(`${name}: approval policy incomplete (${approvals.join(', ') || 'none'})`, 're-run `npm run seed-agents` from this repo');
        }
        if (modelNames.length > 0 && !modelNames.includes(agent.manifest.model.name)) {
          bad(`${name}: model ${agent.manifest.model.name} is not configured in TrueForge`, 'set MODEL_FQN to a configured model and re-run `npm run seed-agents`');
        }
      }
    } catch {
      bad('could not list agents', 'check TrueForge is healthy, then re-run doctor');
    }
  }

  console.log(
    failures === 0
      ? '\nALL CLEAR — run: npm run negotiate -- "book dinner for Abhinav and Priya this weekend"\n'
      : `\n${failures} problem${failures === 1 ? '' : 's'} to fix — re-run \`npm run doctor\` after each fix.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[doctor] fatal:', err);
  process.exit(1);
});
