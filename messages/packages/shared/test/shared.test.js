import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/migrate.js';
import { MessageWriter } from '../src/writer.js';
import { openReadOnlyDb } from '../src/sqlite.js';
import { escapeFtsQuery } from '../src/fts.js';
import { entityId, parseEntityId } from '../src/sources.js';
import { logEvent } from '../src/log.js';

const dir = mkdtempSync(join(tmpdir(), 'messages-shared-'));
const dbPath = join(dir, 'messages.sqlite');

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('entity ids', () => {
  assert.equal(entityId('whatsapp', 'jid@s.whatsapp.net'), 'whatsapp:jid@s.whatsapp.net');
  assert.deepEqual(parseEntityId('gmessages:thread-1'), { source: 'gmessages', nativeId: 'thread-1' });
  assert.equal(parseEntityId('nope'), null);
  assert.throws(() => entityId('sms', '1'));
});

test('migrate + upsert + fts', () => {
  const db = migrate(dbPath);
  const writer = new MessageWriter(db);
  writer.upsertMessage({
    source: 'whatsapp',
    nativeId: 'm1',
    conversationNativeId: 'chat1',
    senderNativeId: 'alice',
    senderDisplayName: 'Alice',
    direction: 'inbound',
    sentAt: 1_700_000_000_000,
    body: 'hello secret project alpha',
    conversationTitle: 'Alice',
    threadType: 'dm',
  });
  writer.upsertMessage({
    source: 'whatsapp',
    nativeId: 'm1',
    conversationNativeId: 'chat1',
    senderNativeId: 'alice',
    direction: 'inbound',
    sentAt: 1_700_000_000_000,
    body: 'hello secret project alpha (edited)',
    conversationTitle: 'Alice',
    threadType: 'dm',
  });
  const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get();
  assert.equal(count.n, 1);
  const fts = db.prepare(`SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH ?`).get(
    escapeFtsQuery('secret project'),
  );
  assert.equal(fts.n, 1);
  const conv = db.prepare('SELECT last_preview FROM conversations WHERE native_id = ?').get('chat1');
  assert.match(conv.last_preview, /edited/);
  db.close();
});

test('conversation title ignores native ids and does not overwrite a real name', () => {
  const titleDbPath = join(dir, 'titles.sqlite');
  const db = migrate(titleDbPath);
  const writer = new MessageWriter(db);
  writer.upsertConversation({
    source: 'whatsapp',
    nativeId: '5630769295596@lid',
    title: '5630769295596@lid',
    threadType: 'dm',
  });
  writer.upsertConversation({
    source: 'whatsapp',
    nativeId: '5630769295596@lid',
    title: 'Maria',
    threadType: 'dm',
  });
  writer.upsertConversation({
    source: 'whatsapp',
    nativeId: '5630769295596@lid',
    title: '5630769295596@lid',
    threadType: 'dm',
  });
  const conv = db.prepare("SELECT title FROM conversations WHERE native_id = '5630769295596@lid'").get();
  assert.equal(conv.title, 'Maria');
  db.close();
});

test('readOnly connection rejects writes', () => {
  const ro = openReadOnlyDb(dbPath);
  assert.throws(() => {
    ro.exec("INSERT INTO messages (id, conversation_id, source, native_id, direction, sent_at, ingested_at, message_type) VALUES ('x','x','whatsapp','x','inbound',1,1,'text')");
  });
  assert.throws(() => {
    ro.prepare('DELETE FROM messages').run();
  });
  const n = ro.prepare('SELECT COUNT(*) AS n FROM messages').get();
  assert.equal(n.n, 1);
  ro.close();
});

test('fts phrase escaping strips operators', () => {
  const escaped = escapeFtsQuery('hello AND "world" OR NOT foo*');
  assert.equal(escaped, '"hello world foo"');
  assert.throws(() => escapeFtsQuery('a'));
});

test('logEvent strips bodies', () => {
  const lines = [];
  const orig = console.log;
  console.log = (msg) => lines.push(msg);
  try {
    logEvent('test', 'ingest', { body: 'SECRET', nativeId: 'm1', token: 't' });
  } finally {
    console.log = orig;
  }
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.body, undefined);
  assert.equal(parsed.token, undefined);
  assert.equal(parsed.nativeId, 'm1');
});
