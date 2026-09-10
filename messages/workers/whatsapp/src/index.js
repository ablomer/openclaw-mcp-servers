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

prepareWorkerProcess();

const SOURCE = 'whatsapp';
const AUTH_DIR = join(SESSIONS_DIR, 'whatsapp');
mkdirSync(AUTH_DIR, { recursive: true });

function messageTypeOf(msg) {
  const m = msg.message || {};
  if (m.conversation || m.extendedTextMessage) return 'text';
  if (m.imageMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return 'audio';
  if (m.documentMessage) return 'document';
  if (m.stickerMessage) return 'sticker';
  if (m.reactionMessage) return 'reaction';
  return 'other';
}

function bodyOf(msg) {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.reactionMessage?.text ||
    null
  );
}

function replyNativeId(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  return ctx?.stanzaId || null;
}

function conversationNativeId(msg) {
  return msg.key.remoteJid;
}

function threadTypeOf(jid) {
  if (!jid) return 'unknown';
  if (jid.endsWith('@g.us')) return 'group';
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) return 'dm';
  return 'unknown';
}

function senderNativeId(msg) {
  if (msg.key.fromMe) return 'me';
  return msg.key.participant || msg.key.remoteJid;
}

function sentAt(msg) {
  return (msg.messageTimestamp ? Number(msg.messageTimestamp) : Math.floor(Date.now() / 1000)) * 1000;
}

function ingestOne(writer, msg, chats = new Map()) {
  if (!msg?.key?.id || !msg.key.remoteJid) return;
  if (msg.messageStubType && !msg.message) return;
  const remote = conversationNativeId(msg);
  const chat = chats.get(remote);
  writer.upsertMessage({
    source: SOURCE,
    nativeId: msg.key.id,
    conversationNativeId: remote,
    senderNativeId: senderNativeId(msg),
    senderDisplayName: chat?.name || null,
    direction: msg.key.fromMe ? 'outbound' : 'inbound',
    sentAt: sentAt(msg),
    messageType: messageTypeOf(msg),
    body: bodyOf(msg),
    replyToNativeId: replyNativeId(msg),
    conversationTitle: chat?.name || remote,
    threadType: threadTypeOf(remote),
    raw: {
      remoteJid: remote,
      fromMe: !!msg.key.fromMe,
      hasMedia: messageTypeOf(msg) !== 'text' && messageTypeOf(msg) !== 'other',
    },
  });
}

async function startSocket(writer) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

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

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      logEvent('whatsapp', 'qr', { hint: 'scan with the phone that owns this account' });
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
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

  sock.ev.on('messaging-history.set', ({ messages = [], chats = [], isLatest }) => {
    const chatMap = new Map(chats.map((c) => [c.id, c]));
    let n = 0;
    for (const msg of messages) {
      ingestOne(writer, msg, chatMap);
      n += 1;
    }
    logEvent('whatsapp', 'history_set', { count: n, isLatest: !!isLatest });
  });

  sock.ev.on('messages.upsert', ({ messages = [], type }) => {
    let n = 0;
    for (const msg of messages) {
      ingestOne(writer, msg);
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
