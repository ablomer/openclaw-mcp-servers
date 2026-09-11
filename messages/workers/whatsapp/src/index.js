import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_DB_PATH,
  MessageWriter,
  SESSIONS_DIR,
  logEvent,
  migrate,
  prepareWorkerProcess,
} from '@openclaw-messages/shared';
import {
  ingestOne,
  persistChat,
  persistContact,
  persistSelf,
  rememberChat,
  rememberContact,
} from './ingest.js';

prepareWorkerProcess();

const AUTH_DIR = join(SESSIONS_DIR, 'whatsapp');
mkdirSync(AUTH_DIR, { recursive: true });

function applyChats(writer, chats, rows = []) {
  for (const chat of rows) {
    rememberChat(chats, chat);
    persistChat(writer, chats.get(chat?.id) || chat);
  }
}

function applyContacts(writer, contacts, rows = []) {
  for (const contact of rows) {
    rememberContact(contacts, contact);
    persistContact(writer, contacts.get(contact?.id) || contact);
  }
}

async function startSocket(writer) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const chats = new Map();
  const contacts = new Map();
  let selfName = persistSelf(writer, state.creds?.me);

  const sock = makeWASocket({
    version,
    auth: state,
    syncFullHistory: true,
    markOnlineOnConnect: false,
    logger: pino({ level: 'silent' }),
  });

  sock.sendMessage = async () => {
    throw new Error('outbound messaging is disabled');
  };
  sock.relayMessage = async () => {
    throw new Error('outbound messaging is disabled');
  };

  sock.ev.on('creds.update', (creds) => {
    saveCreds(creds);
    if (creds?.me) selfName = persistSelf(writer, creds.me);
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      logEvent('whatsapp', 'qr', { hint: 'scan with the phone that owns this account' });
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      selfName = persistSelf(writer, sock.user || state.creds?.me);
      logEvent('whatsapp', 'connected');
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      logEvent('whatsapp', 'disconnected', { code, loggedOut: !!loggedOut });
      if (!loggedOut) {
        setTimeout(() => {
          startSocket(writer).catch((err) => logEvent('whatsapp', 'restart_failed', { name: err?.name }));
        }, 2000);
      }
    }
  });

  sock.ev.on('messaging-history.set', ({ messages = [], chats: historyChats = [], contacts: historyContacts = [] }) => {
    applyChats(writer, chats, historyChats);
    applyContacts(writer, contacts, historyContacts);
    let n = 0;
    for (const msg of messages) {
      ingestOne(writer, msg, { chats, contacts, selfName });
      n += 1;
    }
    logEvent('whatsapp', 'history_set', { count: n, chats: historyChats.length, contacts: historyContacts.length });
  });

  sock.ev.on('chats.upsert', (rows = []) => {
    applyChats(writer, chats, rows);
  });
  sock.ev.on('chats.update', (rows = []) => {
    applyChats(writer, chats, rows);
  });
  sock.ev.on('contacts.upsert', (rows = []) => {
    applyContacts(writer, contacts, rows);
  });
  sock.ev.on('contacts.update', (rows = []) => {
    applyContacts(writer, contacts, rows);
  });

  sock.ev.on('messages.upsert', ({ messages = [], type }) => {
    let n = 0;
    for (const msg of messages) {
      ingestOne(writer, msg, { chats, contacts, selfName });
      n += 1;
    }
    logEvent('whatsapp', 'upsert', { count: n, type });
  });

  logEvent('whatsapp', 'started', { authDir: 'whatsapp' });
}

async function start() {
  const db = migrate(DEFAULT_DB_PATH);
  const writer = new MessageWriter(db);
  await startSocket(writer);
}

start().catch((err) => {
  logEvent('whatsapp', 'fatal', { name: err?.name });
  process.exit(1);
});
