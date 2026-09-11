import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { hasToken, parseCredentials, persistTokens, tokenPath } from '../src/auth.js';

const dir = mkdtempSync(join(tmpdir(), 'google-health-auth-'));
const env = { GOOGLE_HEALTH_DATA_DIR: dir };

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('parseCredentials accepts installed or web clients', () => {
  const installed = parseCredentials({
    installed: {
      client_id: 'id',
      client_secret: 'secret',
      redirect_uris: ['https://www.google.com'],
    },
  });
  assert.equal(installed.redirect_uri, 'https://www.google.com');
  const web = parseCredentials({ web: { client_id: 'id', client_secret: 'secret' } });
  assert.equal(web.redirect_uri, 'https://www.google.com');
  assert.throws(() => parseCredentials({}), /client_id/);
});

test('persistTokens keeps an existing refresh_token', () => {
  writeFileSync(join(dir, 'token.json'), JSON.stringify({ refresh_token: 'keep', access_token: 'old' }));
  persistTokens({ access_token: 'new' }, env);
  const saved = JSON.parse(readFileSync(tokenPath(env), 'utf8'));
  assert.equal(saved.refresh_token, 'keep');
  assert.equal(saved.access_token, 'new');
  assert.equal(hasToken(env), true);
});
