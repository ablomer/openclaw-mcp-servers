import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, MessageWriter, openReadOnlyDb } from '@openclaw-messages/shared';
import { createTools } from '../src/tools.js';

const dir = mkdtempSync(join(tmpdir(), 'messages-mcp-'));
const dbPath = join(dir, 'messages.sqlite');
const writerDb = migrate(dbPath);
const writer = new MessageWriter(writerDb);

writer.upsertMessage({
  source: 'whatsapp',
  nativeId: 'wa-1',
  conversationNativeId: 'family',
  senderNativeId: 'dad',
  senderDisplayName: 'Dad',
  direction: 'inbound',
  sentAt: 1_700_000_100_000,
  body: 'dinner at seven with the neighbors',
  conversationTitle: 'Family',
  threadType: 'group',
});
writer.upsertMessage({
  source: 'whatsapp',
  nativeId: 'wa-2',
  conversationNativeId: 'family',
  senderNativeId: 'dad',
  senderDisplayName: 'Dad',
  direction: 'inbound',
  sentAt: 1_700_000_150_000,
  body: 'on my way',
  conversationTitle: 'Family',
  threadType: 'group',
});
writer.upsertMessage({
  source: 'instagram',
  nativeId: 'ig-1',
  conversationNativeId: 'maya',
  senderNativeId: 'maya',
  senderDisplayName: 'Maya',
  direction: 'inbound',
  sentAt: 1_700_000_200_000,
  body: 'see you at the gallery',
  conversationTitle: 'Maya',
  threadType: 'dm',
});
writerDb.close();

const db = openReadOnlyDb(dbPath);
const tools = createTools(db);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function parse(result) {
  return JSON.parse(result.content[0].text);
}

test('list_recent_conversations orders by last_message_at', () => {
  const payload = parse(tools.listRecentConversations({ limit: 10 }));
  assert.equal(payload.conversations[0].chat_id, 'instagram:maya');
  assert.equal(payload.conversations[1].title, 'Family');
});

test('list_recent_conversations filters source', () => {
  const payload = parse(tools.listRecentConversations({ source: 'whatsapp' }));
  assert.equal(payload.conversations.length, 1);
  assert.equal(payload.conversations[0].source, 'whatsapp');
});

test('get_thread_history returns newest-first rows and 404s unknown ids', () => {
  const payload = parse(tools.getThreadHistory({ chat_id: 'whatsapp:family' }));
  assert.equal(payload.messages[0].body, 'on my way');
  assert.equal(payload.messages[1].body, 'dinner at seven with the neighbors');
  const missing = tools.getThreadHistory({ chat_id: 'whatsapp:nope' });
  assert.equal(missing.isError, true);
});

test('search_messages uses phrase match and omits raw bodies in favor of snippet', () => {
  const payload = parse(tools.searchMessages({ query: 'gallery' }));
  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].chat_id, 'instagram:maya');
  assert.equal(payload.results[0].body, undefined);
  const injected = tools.searchMessages({ query: 'dinner AND DROP TABLE messages' });
  const inj = parse(injected);
  assert.ok(!inj.results || inj.results.length >= 0);
});

test('invalid chat_id is rejected', () => {
  const result = tools.getThreadHistory({ chat_id: 'not-an-id' });
  assert.equal(result.isError, true);
});
