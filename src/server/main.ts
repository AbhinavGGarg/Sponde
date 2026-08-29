import { buildApp } from './app.js';
import { sealMailEnabled, startSealWatcher } from './mailer.js';

const PORT = Number(process.env.SWITCHBOARD_PORT ?? 7400); // internal env vars keep the protocol name
const HOST = '127.0.0.1'; // loopback only — agents and viewer are local by design

const { app, store } = buildApp();

app.listen(PORT, HOST, () => {
  console.log(`[switchboard] MCP endpoint  http://localhost:${PORT}/mcp`);
  console.log(`[switchboard] operator view http://localhost:${PORT}/`);
  console.log(
    `[switchboard] register in TrueForge: Settings → Connectors → Add MCP Server → name "switchboard", URL http://localhost:${PORT}/mcp`,
  );
  if (sealMailEnabled()) {
    startSealWatcher(store);
    console.log('[seal-mail] enabled — sealed rooms email a real calendar invite to both humans');
  } else {
    console.log('[seal-mail] disabled — set GMAIL_USER + GMAIL_APP_PASSWORD (and optionally SEAL_EMAIL_TO) to send real invites on seal');
  }
});
