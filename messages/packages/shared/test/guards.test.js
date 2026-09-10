import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('whatsapp worker source never calls send/relay APIs', () => {
  const src = readFileSync(join(root, 'workers/whatsapp/src/index.js'), 'utf8');
  assert.match(src, /outbound messaging is disabled/);
  assert.equal((src.match(/sendMessage/g) || []).length, 1);
  assert.equal((src.match(/relayMessage/g) || []).length, 1);
  assert.doesNotMatch(src, /\.sendMessage\s*\(/);
  assert.doesNotMatch(src, /\.relayMessage\s*\(/);
});

test('mcp server exposes only the three read tools', () => {
  const src = readFileSync(join(root, 'mcp-server/src/server.js'), 'utf8');
  assert.match(src, /list_recent_conversations/);
  assert.match(src, /get_thread_history/);
  assert.match(src, /search_messages/);
  assert.doesNotMatch(src, /send_/);
});
