#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrate, MessageWriter } from '../packages/shared/src/index.js';

const dbPath = process.argv[2] || join(process.cwd(), 'data/messages/db/messages.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = migrate(dbPath);
const writer = new MessageWriter(db);
const now = Date.now();
writer.upsertMessage({
  source: 'whatsapp',
  nativeId: 'fixture-1',
  conversationNativeId: 'fixture-chat',
  senderNativeId: 'alice',
  senderDisplayName: 'Alice',
  direction: 'inbound',
  sentAt: now - 60_000,
  body: 'fixture hello from alice',
  conversationTitle: 'Alice',
  threadType: 'dm',
});
writer.upsertMessage({
  source: 'gmessages',
  nativeId: 'fixture-2',
  conversationNativeId: 'sms-bob',
  senderNativeId: 'bob',
  senderDisplayName: 'Bob',
  direction: 'inbound',
  sentAt: now,
  body: 'fixture sms from bob',
  conversationTitle: 'Bob',
  threadType: 'dm',
});
db.close();
console.log(JSON.stringify({ event: 'seeded', dbPath }));
