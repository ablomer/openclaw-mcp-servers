// Bootstrap a cookie session for the Instagram worker (run on a trusted machine).
// Usage:
//   INSTAGRAM_USERNAME=you INSTAGRAM_PASSWORD=... node workers/instagram/src/login.js
// This writes /sessions/instagram/session.json (or ./session.json if SESSIONS_DIR unset).
// Never pass the resulting file to MCP. 2FA/checkpoint must be completed interactively.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IgApiClient } from 'instagram-private-api';

const username = process.env.INSTAGRAM_USERNAME;
const password = process.env.INSTAGRAM_PASSWORD;
if (!username || !password) {
  console.error('INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD are required');
  process.exit(1);
}

const dir = join(process.env.SESSIONS_DIR || '/sessions', 'instagram');
mkdirSync(dir, { recursive: true });
const ig = new IgApiClient();
ig.state.generateDevice(username);
await ig.account.login(username, password);
const serialized = await ig.state.serialize();
delete serialized.constants;
writeFileSync(join(dir, 'session.json'), JSON.stringify(serialized), { mode: 0o600 });
console.log(JSON.stringify({ ts: Date.now(), event: 'session_written', dir: 'instagram' }));
