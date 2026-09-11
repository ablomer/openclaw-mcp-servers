import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, MessageWriter, openReadOnlyDb, zonedLocalToUtcMs } from '@openclaw-messages/shared';
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
writer.upsertMessage({
  source: 'whatsapp',
  nativeId: 'wa-old',
  conversationNativeId: 'family',
  senderNativeId: 'dad',
  senderDisplayName: 'Dad',
  direction: 'inbound',
  sentAt: zonedLocalToUtcMs(2026, 9, 7, 9, 0, 0),
  body: 'too old for the three-day window',
  conversationTitle: 'Family',
  threadType: 'group',
});
writer.upsertMessage({
  source: 'whatsapp',
  nativeId: 'wa-3',
  conversationNativeId: 'family',
  senderNativeId: 'dad',
  senderDisplayName: 'Dad',
  direction: 'inbound',
  sentAt: zonedLocalToUtcMs(2026, 9, 8, 18, 30, 0),
  body: 'monday dinner plans',
  conversationTitle: 'Family',
  threadType: 'group',
});
writer.upsertMessage({
  source: 'whatsapp',
  nativeId: 'wa-4',
  conversationNativeId: 'family',
  senderNativeId: 'mom',
  senderDisplayName: 'Mom',
  direction: 'inbound',
  sentAt: zonedLocalToUtcMs(2026, 9, 9, 8, 15, 0),
  body: 'bringing dessert',
  conversationTitle: 'Family',
  threadType: 'group',
});
writer.upsertMessage({
  source: 'instagram',
  nativeId: 'ig-2',
  conversationNativeId: 'maya',
  senderNativeId: 'maya',
  senderDisplayName: 'Maya',
  direction: 'inbound',
  sentAt: zonedLocalToUtcMs(2026, 9, 10, 11, 0, 0),
  body: 'running a few minutes late',
  conversationTitle: 'Maya',
  threadType: 'dm',
});
writer.upsertMessage({
  source: 'whatsapp',
  nativeId: 'wa-media',
  conversationNativeId: 'family',
  senderNativeId: 'dad',
  senderDisplayName: 'Dad',
  direction: 'inbound',
  sentAt: zonedLocalToUtcMs(2026, 9, 8, 17, 0, 0),
  messageType: 'image',
  body: null,
  conversationTitle: 'Family',
  threadType: 'group',
});
writer.upsertMessage({
  source: 'whatsapp',
  nativeId: 'wa-blank',
  conversationNativeId: 'family',
  senderNativeId: 'dad',
  senderDisplayName: 'Dad',
  direction: 'inbound',
  sentAt: zonedLocalToUtcMs(2026, 9, 8, 17, 15, 0),
  messageType: 'sticker',
  body: '   ',
  conversationTitle: 'Family',
  threadType: 'group',
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
  assert.equal(payload.messages[0].body, 'bringing dessert');
  assert.equal(payload.messages[1].body, 'monday dinner plans');
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

const noon = zonedLocalToUtcMs(2026, 9, 10, 12, 0, 0);
const ranged = createTools(db, { nowMs: noon });

test('list_messages groups a calendar-day range by thread with display times', () => {
  const payload = parse(ranged.listMessages({ from: '2026-09-08', to: '2026-09-10' }));
  assert.equal(payload.from, '2026-09-08');
  assert.equal(payload.to, '2026-09-10');
  assert.equal(payload.truncated, false);
  assert.equal(payload.threads.length, 2);
  assert.equal(payload.threads[0].chat_id, 'instagram:maya');
  assert.equal(payload.threads[0].title, 'Maya');
  assert.equal(payload.threads[0].messages.length, 1);
  assert.equal(payload.threads[0].messages[0].body, 'running a few minutes late');
  assert.match(payload.threads[0].messages[0].sent_at, /^Thursday, 2026-09-10 11:00:00 AM EDT$/);
  assert.equal(payload.threads[1].chat_id, 'whatsapp:family');
  assert.deepEqual(
    payload.threads[1].messages.map((row) => row.body),
    ['monday dinner plans', 'bringing dessert'],
  );
  assert.equal(payload.threads[1].messages[0].sender, 'Dad');
  assert.equal(payload.threads[1].messages[1].sender, 'Mom');
  assert.equal(JSON.stringify(payload).includes('sent_at":1'), false);
});

test('list_messages days=3 skips older rows and can filter source', () => {
  const payload = parse(ranged.listMessages({ days: 3, source: 'whatsapp' }));
  assert.equal(payload.from, '2026-09-08');
  assert.equal(payload.to, '2026-09-10');
  assert.equal(payload.threads.length, 1);
  assert.equal(payload.threads[0].chat_id, 'whatsapp:family');
  assert.equal(payload.threads[0].messages.some((row) => row.body.includes('too old')), false);
});

test('list_messages sets truncated when over the message cap', () => {
  const payload = parse(ranged.listMessages({ from: '2026-09-08', to: '2026-09-10', limit: 1 }));
  assert.equal(payload.truncated, true);
  assert.equal(payload.threads.reduce((n, thread) => n + thread.messages.length, 0), 1);
});

test('list_messages rejects an invalid date', () => {
  const result = ranged.listMessages({ from: 'last Tuesday' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /YYYY-MM-DD/);
});

test('list_messages excludes empty bodies by default', () => {
  const payload = parse(ranged.listMessages({ from: '2026-09-08', to: '2026-09-10' }));
  const bodies = payload.threads.flatMap((thread) => thread.messages.map((row) => row.body));
  assert.equal(bodies.includes(null), false);
  assert.equal(bodies.some((body) => typeof body === 'string' && body.trim() === ''), false);
  assert.equal(
    payload.threads.find((thread) => thread.chat_id === 'whatsapp:family')?.messages.length,
    2,
  );
});

test('list_messages include_empty returns body-less messages', () => {
  const payload = parse(ranged.listMessages({
    from: '2026-09-08',
    to: '2026-09-10',
    include_empty: true,
  }));
  const family = payload.threads.find((thread) => thread.chat_id === 'whatsapp:family');
  assert.equal(family?.messages.some((row) => row.id === 'whatsapp:wa-media' && row.body == null), true);
  assert.equal(family?.messages.some((row) => row.id === 'whatsapp:wa-blank' && row.body === '   '), true);
});

test('list_messages uses peer contact names when the stored title is a jid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'messages-title-'));
  const titleDbPath = join(dir, 'messages.sqlite');
  const titleWriterDb = migrate(titleDbPath);
  const titleWriter = new MessageWriter(titleWriterDb);
  const noonMs = zonedLocalToUtcMs(2026, 9, 10, 12, 0, 0);

  titleWriter.upsertMessage({
    source: 'whatsapp',
    nativeId: 'wa-dm-1',
    conversationNativeId: '5630769295596@lid',
    senderNativeId: '5630769295596@lid',
    senderDisplayName: 'Maria',
    direction: 'inbound',
    sentAt: zonedLocalToUtcMs(2026, 9, 10, 15, 4, 25),
    body: 'Oiêeeeeeeeee',
    conversationTitle: '5630769295596@lid',
    threadType: 'dm',
  });
  titleWriter.upsertMessage({
    source: 'whatsapp',
    nativeId: 'wa-dm-2',
    conversationNativeId: '5630769295596@lid',
    senderNativeId: 'me',
    senderDisplayName: "We're Going To Disney!",
    direction: 'outbound',
    sentAt: zonedLocalToUtcMs(2026, 9, 10, 14, 58, 35),
    body: 'Nêeeeee',
    conversationTitle: '5630769295596@lid',
    threadType: 'dm',
  });
  titleWriterDb.close();

  const titleDb = openReadOnlyDb(titleDbPath);
  const titleTools = createTools(titleDb, { nowMs: noonMs });
  const payload = parse(titleTools.listMessages({ days: 3 }));
  const thread = payload.threads[0];

  titleDb.close();
  rmSync(dir, { recursive: true, force: true });

  assert.equal(thread.title, 'Maria');
  assert.equal(thread.thread_type, 'dm');
  assert.equal(thread.messages[0].sender, 'You');
  assert.equal(thread.messages[0].body, 'Nêeeeee');
  assert.equal(thread.messages[1].sender, 'Maria');
});

test('list_messages limit ignores excluded empty bodies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'messages-limit-'));
  const limitDbPath = join(dir, 'messages.sqlite');
  const limitWriterDb = migrate(limitDbPath);
  const limitWriter = new MessageWriter(limitWriterDb);
  const noonMs = zonedLocalToUtcMs(2026, 9, 10, 12, 0, 0);

  for (let i = 0; i < 5; i += 1) {
    limitWriter.upsertMessage({
      source: 'whatsapp',
      nativeId: `wa-empty-${i}`,
      conversationNativeId: 'family',
      senderNativeId: 'dad',
      senderDisplayName: 'Dad',
      direction: 'inbound',
      sentAt: noonMs + i * 1000,
      messageType: 'image',
      body: null,
      conversationTitle: 'Family',
      threadType: 'group',
    });
  }
  limitWriter.upsertMessage({
    source: 'whatsapp',
    nativeId: 'wa-text-1',
    conversationNativeId: 'family',
    senderNativeId: 'dad',
    senderDisplayName: 'Dad',
    direction: 'inbound',
    sentAt: zonedLocalToUtcMs(2026, 9, 9, 8, 0, 0),
    body: 'first text',
    conversationTitle: 'Family',
    threadType: 'group',
  });
  limitWriter.upsertMessage({
    source: 'whatsapp',
    nativeId: 'wa-text-2',
    conversationNativeId: 'family',
    senderNativeId: 'mom',
    senderDisplayName: 'Mom',
    direction: 'inbound',
    sentAt: zonedLocalToUtcMs(2026, 9, 9, 9, 0, 0),
    body: 'second text',
    conversationTitle: 'Family',
    threadType: 'group',
  });
  limitWriterDb.close();

  const limitDb = openReadOnlyDb(limitDbPath);
  const limitTools = createTools(limitDb, { nowMs: noonMs });
  const payload = parse(limitTools.listMessages({
    from: '2026-09-08',
    to: '2026-09-10',
    limit: 2,
  }));

  limitDb.close();
  rmSync(dir, { recursive: true, force: true });

  assert.equal(payload.truncated, false);
  assert.deepEqual(
    payload.threads[0].messages.map((row) => row.body),
    ['first text', 'second text'],
  );
});
