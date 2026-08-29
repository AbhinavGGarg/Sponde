import { buildApp } from './app.js';

const PORT = Number(process.env.SWITCHBOARD_PORT ?? 7400); // internal env vars keep the protocol name
const HOST = '127.0.0.1'; // loopback only — agents and viewer are local by design

const { app } = buildApp();

app.listen(PORT, HOST, () => {
  console.log(`[switchboard] MCP endpoint  http://localhost:${PORT}/mcp`);
  console.log(`[switchboard] operator view http://localhost:${PORT}/`);
  console.log(
    `[switchboard] register in TrueForge: Settings → Connectors → Add MCP Server → name "switchboard", URL http://localhost:${PORT}/mcp`,
  );
});
