export const SOURCE = 'whatsapp';
const SELF_NATIVE_ID = 'me';

const JID_SUFFIX = /@(?:lid|g\.us|s\.whatsapp\.net|broadcast|newsletter)$/i;

export function humanName(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (JID_SUFFIX.test(text)) return null;
  return text;
}

export function threadTypeOf(jid) {
  if (!jid) return 'unknown';
  if (String(jid).endsWith('@g.us')) return 'group';
  if (String(jid).endsWith('@s.whatsapp.net') || String(jid).endsWith('@lid')) return 'dm';
  return 'unknown';
}

export function conversationNativeId(msg) {
  return msg?.key?.remoteJid || null;
}

export function senderNativeId(msg) {
  if (msg?.key?.fromMe) return SELF_NATIVE_ID;
  return msg?.key?.participant || msg?.key?.remoteJid || null;
}

export function contactDisplayName(contact) {
  return (
    humanName(contact?.name) ||
    humanName(contact?.notify) ||
    humanName(contact?.verifiedName) ||
    null
  );
}

export function selfDisplayName(me) {
  return contactDisplayName(me) || 'You';
}

export function rememberByIds(map, record, ids) {
  if (!record || !map) return;
  for (const id of ids) {
    if (!id) continue;
    const prev = map.get(id) || {};
    map.set(id, { ...prev, ...record });
  }
}

export function rememberChat(chats, chat) {
  if (!chat?.id) return;
  rememberByIds(chats, chat, [chat.id]);
}

export function rememberContact(contacts, contact) {
  if (!contact?.id && !contact?.lid && !contact?.jid) return;
  rememberByIds(contacts, contact, [contact.id, contact.lid, contact.jid]);
}

export function contactNativeIds(contact) {
  return [...new Set([contact?.id, contact?.lid, contact?.jid].filter(Boolean).map(String))];
}

function lookup(map, id) {
  if (!map || id == null) return null;
  return map.get(id) || null;
}

export function senderDisplayName(msg, { contacts, selfName } = {}) {
  if (msg?.key?.fromMe) return humanName(selfName) || 'You';
  const contact = lookup(contacts, senderNativeId(msg));
  return contactDisplayName(contact) || humanName(msg?.pushName) || humanName(msg?.verifiedBizName) || null;
}

export function conversationTitle(msg, { chats, contacts } = {}) {
  const remote = conversationNativeId(msg);
  const fromChat = humanName(lookup(chats, remote)?.name);
  if (fromChat) return fromChat;
  if (threadTypeOf(remote) === 'group') return null;
  const peerName = contactDisplayName(lookup(contacts, remote));
  if (peerName) return peerName;
  if (!msg?.key?.fromMe) return humanName(msg?.pushName) || null;
  return null;
}

export function persistContact(writer, contact) {
  const displayName = contactDisplayName(contact);
  if (!displayName) return;
  const handle = contact?.jid || contact?.id || null;
  for (const nativeId of contactNativeIds(contact)) {
    writer.upsertContact({
      source: SOURCE,
      nativeId,
      displayName,
      handle: handle && handle !== nativeId ? handle : nativeId,
    });
  }
}

export function persistChat(writer, chat) {
  if (!chat?.id) return;
  writer.upsertConversation({
    source: SOURCE,
    nativeId: chat.id,
    title: humanName(chat.name),
    threadType: threadTypeOf(chat.id),
  });
}

export function persistSelf(writer, me) {
  const displayName = selfDisplayName(me);
  writer.upsertContact({
    source: SOURCE,
    nativeId: SELF_NATIVE_ID,
    displayName,
    handle: me?.id || me?.jid || null,
  });
  return displayName;
}

export function ingestOne(writer, msg, { chats, contacts, selfName } = {}) {
  if (!msg?.key?.id || !msg.key.remoteJid) return;
  if (msg.messageStubType && !msg.message) return;
  const remote = conversationNativeId(msg);
  const type = messageTypeOf(msg);
  writer.upsertMessage({
    source: SOURCE,
    nativeId: msg.key.id,
    conversationNativeId: remote,
    senderNativeId: senderNativeId(msg),
    senderDisplayName: senderDisplayName(msg, { contacts, selfName }),
    direction: msg.key.fromMe ? 'outbound' : 'inbound',
    sentAt: sentAt(msg),
    messageType: type,
    body: bodyOf(msg),
    replyToNativeId: replyNativeId(msg),
    conversationTitle: conversationTitle(msg, { chats, contacts }),
    threadType: threadTypeOf(remote),
    raw: {
      remoteJid: remote,
      fromMe: !!msg.key.fromMe,
      hasMedia: type !== 'text' && type !== 'reaction' && type !== 'other',
    },
  });
}

function innerContent(msg) {
  const m = msg.message || {};
  return (
    m.ephemeralMessage?.message
    || m.viewOnceMessage?.message
    || m.viewOnceMessageV2?.message
    || m.viewOnceMessageV2Extension?.message
    || m.documentWithCaptionMessage?.message
    || m
  );
}

export function messageTypeOf(msg) {
  const m = innerContent(msg);
  if (m.conversation || m.extendedTextMessage) return 'text';
  if (m.imageMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return 'audio';
  if (m.documentMessage) return 'document';
  if (m.stickerMessage) return 'sticker';
  if (m.reactionMessage) return 'reaction';
  return 'other';
}

export function bodyOf(msg) {
  const m = innerContent(msg);
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
  const m = innerContent(msg);
  if (m.reactionMessage?.key?.id) return m.reactionMessage.key.id;
  const ctx = m.extendedTextMessage?.contextInfo;
  return ctx?.stanzaId || null;
}

function sentAt(msg) {
  return (msg.messageTimestamp ? Number(msg.messageTimestamp) : Math.floor(Date.now() / 1000)) * 1000;
}
