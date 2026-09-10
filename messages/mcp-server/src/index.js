import { existsSync } from 'node:fs';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { openReadOnlyDb, logEvent } from '@openclaw-messages/shared';
import { buildServer } from './server.js';

const DB_PATH = process.env.MESSAGES_DB_PATH || '/data/messages.sqlite';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDb() {
  while (!existsSync(DB_PATH)) {
    logEvent('mcp', 'waiting_for_db');
    await sleep(2000);
  }
  for (;;) {
    try {
      return openReadOnlyDb(DB_PATH);
    } catch (err) {
      logEvent('mcp', 'db_open_retry', { name: err?.name });
      await sleep(2000);
    }
  }
}

const db = await waitForDb();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, readonly: true });
});

app.all('/mcp', async (req, res) => {
  const mcp = buildServer(db);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: [
      'messages-mcp',
      'messages-mcp:3000',
      '127.0.0.1',
      '127.0.0.1:3000',
      'localhost',
      'localhost:3000',
    ],
  });
  res.on('close', () => {
    transport.close().catch(() => {});
    mcp.close().catch(() => {});
  });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logEvent('mcp', 'request_error', { status: err.status });
    if (!res.headersSent) {
      res.status(500).json({ error: 'mcp_failed' });
    }
  }
});

app.listen(PORT, HOST, () => {
  logEvent('mcp', 'listen', { host: HOST, port: PORT, db: 'messages.sqlite' });
});
