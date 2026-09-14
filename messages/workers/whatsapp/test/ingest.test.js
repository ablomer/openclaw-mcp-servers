import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, MessageWriter } from '@openclaw-messages/shared';
import {
  conversationTitle,
  humanName,
  ingestOne,
  persistChat,
  persistContact,
  persistSelf,
  senderDisplayName,
  senderNativeId,
  threadTypeOf,
} from '../src/ingest.js';

const dir = mkdtempSync(join(tmpdir(), 'whatsapp-ingest-'));
const dbPath = join(dir, 'messages.sqlite');

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function textMsg({ id, remoteJid, fromMe = false, participant, pushName, text, ts = 1_700_000_000 }) {
  return {
    key: { id, remoteJid, fromMe, participant },
    pushName,
    messageTimestamp: ts,
    message: { conversation: text },
  };
}

test('humanName rejects WhatsApp addresses', () => {
  assert.equal(humanName('  Maya  '), 'Maya');
  assert.equal(humanName('5630769295596@lid'), null);
  assert.equal(humanName('14437456929-1496015988@g.us'), null);
});

test('thread types and sender ids', () => {
  assert.equal(threadTypeOf('5630769295596@lid'), 'dm');
  assert.equal(threadTypeOf('14437456929-1496015988@g.us'), 'group');
  assert.equal(
    senderNativeId(textMsg({ id: '1', remoteJid: '5630769295596@lid', fromMe: true })),
    'me',
  );
  assert.equal(
    senderNativeId(textMsg({
      id: '2',
      remoteJid: 'family@g.us',
      participant: 'dad@lid',
    })),
    'dad@lid',
  );
});

test('sender names come from the person, never the chat or group title', () => {
  const chats = new Map([['family@g.us', { id: 'family@g.us', name: "We're Going To Disney!" }]]);
  const outbound = textMsg({
    id: 'out',
    remoteJid: '5630769295596@lid',
    fromMe: true,
    text: 'Nêeeeee',
  });
  const inbound = textMsg({
    id: 'in',
    remoteJid: 'family@g.us',
    participant: 'dad@lid',
    pushName: 'Dad',
    text: 'on my way',
  });
  assert.equal(senderDisplayName(outbound, { chats, selfName: 'Augusto' }), 'Augusto');
  assert.equal(senderDisplayName(inbound, { chats }), 'Dad');
  assert.equal(conversationTitle(inbound, { chats }), "We're Going To Disney!");
  assert.equal(conversationTitle(outbound, { chats: new Map() }), null);
});

test('ingest stores contact and group names instead of raw jids', () => {
  const db = migrate(dbPath);
  const writer = new MessageWriter(db);
  const chats = new Map([
    ['family@g.us', { id: 'family@g.us', name: "We're Going To Disney!" }],
    ['5630769295596@lid', { id: '5630769295596@lid', name: 'Maria' }],
  ]);
  const contacts = new Map([
    ['dad@lid', { id: 'dad@lid', name: 'Dad' }],
  ]);

  persistSelf(writer, { name: 'Augusto' });
  persistChat(writer, chats.get('family@g.us'));
  persistContact(writer, { id: '5630769295596@lid', name: 'Maria', notify: 'Maria WA' });

  ingestOne(writer, textMsg({
    id: 'wa-out',
    remoteJid: '5630769295596@lid',
    fromMe: true,
    text: 'Nêeeeee',
    ts: 1_700_000_100,
  }), { chats, contacts, selfName: 'Augusto' });

  ingestOne(writer, textMsg({
    id: 'wa-in',
    remoteJid: '5630769295596@lid',
    pushName: 'Maria',
    text: 'Oiêeeeeeeeee',
    ts: 1_700_000_200,
  }), { chats, contacts, selfName: 'Augusto' });

  ingestOne(writer, textMsg({
    id: 'wa-group',
    remoteJid: 'family@g.us',
    participant: 'dad@lid',
    pushName: 'Dad',
    text: '❤️',
    ts: 1_700_000_300,
  }), { chats, contacts, selfName: 'Augusto' });

  ingestOne(writer, textMsg({
    id: 'wa-live',
    remoteJid: '5630769295596@lid',
    fromMe: true,
    text: 'Estou indo!',
    ts: 1_700_000_400,
  }), { chats: new Map(), contacts, selfName: 'Augusto' });

  const convs = db.prepare('SELECT native_id, title, thread_type FROM conversations ORDER BY native_id').all();
  assert.deepEqual(convs, [
    { native_id: '5630769295596@lid', title: 'Maria', thread_type: 'dm' },
    { native_id: 'family@g.us', title: "We're Going To Disney!", thread_type: 'group' },
  ]);

  const me = db.prepare("SELECT display_name FROM contacts WHERE native_id = 'me'").get();
  assert.equal(me.display_name, 'Augusto');

  const maria = db.prepare("SELECT display_name FROM contacts WHERE native_id = '5630769295596@lid'").get();
  assert.equal(maria.display_name, 'Maria');

  const dad = db.prepare("SELECT display_name FROM contacts WHERE native_id = 'dad@lid'").get();
  assert.equal(dad.display_name, 'Dad');

  db.close();
});

test('reactions point at the target message instead of standing alone', () => {
  const reactionPath = join(dir, 'reactions.sqlite');
  const db = migrate(reactionPath);
  const writer = new MessageWriter(db);
  const chats = new Map([['family@g.us', { id: 'family@g.us', name: "We're Going To Disney!" }]]);
  const contacts = new Map([['mom@lid', { id: 'mom@lid', name: 'Mom' }]]);

  ingestOne(writer, textMsg({
    id: 'wa-group',
    remoteJid: 'family@g.us',
    participant: 'dad@lid',
    pushName: 'Dad',
    text: '❤️',
    ts: 1_700_000_300,
  }), { chats, contacts, selfName: 'Augusto' });

  ingestOne(writer, {
    key: { id: 'rxn-1', remoteJid: 'family@g.us', fromMe: false, participant: 'mom@lid' },
    pushName: 'Mom',
    messageTimestamp: 1_700_000_500,
    message: {
      reactionMessage: {
        key: { id: 'wa-group', remoteJid: 'family@g.us', fromMe: false },
        text: '😂',
      },
    },
  }, { chats, contacts, selfName: 'Augusto' });

  ingestOne(writer, {
    key: { id: 'rxn-wrap', remoteJid: 'family@g.us', fromMe: true },
    messageTimestamp: 1_700_000_600,
    message: {
      ephemeralMessage: {
        message: {
          reactionMessage: {
            key: { id: 'wa-group', remoteJid: 'family@g.us', fromMe: false },
            text: '👍',
          },
        },
      },
    },
  }, { chats, contacts, selfName: 'Augusto' });

  const rows = db.prepare(`
    SELECT native_id, message_type, body, reply_to_id
    FROM messages
    ORDER BY native_id
  `).all();
  assert.deepEqual(rows, [
    { native_id: 'rxn-1', message_type: 'reaction', body: '😂', reply_to_id: 'whatsapp:wa-group' },
    { native_id: 'rxn-wrap', message_type: 'reaction', body: '👍', reply_to_id: 'whatsapp:wa-group' },
    { native_id: 'wa-group', message_type: 'text', body: '❤️', reply_to_id: null },
  ]);

  const conv = db.prepare("SELECT last_preview FROM conversations WHERE native_id = 'family@g.us'").get();
  assert.equal(conv.last_preview, '❤️');
  db.close();
});

test('a later message without chat metadata does not replace a real title with a jid', () => {
  const laterPath = join(dir, 'later.sqlite');
  const db = migrate(laterPath);
  const writer = new MessageWriter(db);
  ingestOne(writer, textMsg({
    id: 'first',
    remoteJid: '5630769295596@lid',
    pushName: 'Maria',
    text: 'hello',
    ts: 1,
  }), { chats: new Map([['5630769295596@lid', { id: '5630769295596@lid', name: 'Maria' }]]) });
  ingestOne(writer, textMsg({
    id: 'second',
    remoteJid: '5630769295596@lid',
    fromMe: true,
    text: 'hi',
    ts: 2,
  }));
  const conv = db.prepare("SELECT title FROM conversations WHERE native_id = '5630769295596@lid'").get();
  assert.equal(conv.title, 'Maria');
  db.close();
});
