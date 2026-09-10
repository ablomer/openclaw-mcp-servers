import { existsSync } from 'node:fs';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { DEFAULT_GOG_BIN, logEvent } from '@openclaw-gog/shared';
import { buildServer } from './server.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const GOG_BIN = process.env.GOG_BIN || DEFAULT_GOG_BIN;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, gog: existsSync(GOG_BIN) });
});

app.all('/mcp', async (req, res) => {
  const mcp = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: [
      'email-mcp',
      'email-mcp:3000',
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
  logEvent('mcp', 'listen', { host: HOST, port: PORT, name: 'email-readonly' });
});
