import { DIRECTIONS, MESSAGE_TYPES, THREAD_TYPES, entityId, isSource } from './sources.js';

const PREVIEW_LEN = 180;
const ADDRESS_TITLE = /@(?:lid|g\.us|s\.whatsapp\.net|broadcast|newsletter)$/i;

export function usableConversationTitle(title, nativeId) {
  if (title == null) return null;
  const text = String(title).trim();
  if (!text) return null;
  if (nativeId != null && text === String(nativeId)) return null;
  if (ADDRESS_TITLE.test(text)) return null;
  return text;
}

function nowMs() {
  return Date.now();
}

function preview(body) {
  if (body == null) return null;
  const text = String(body).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= PREVIEW_LEN ? text : `${text.slice(0, PREVIEW_LEN)}…`;
}

function runWithBusyRetry(fn) {
  return fn();
}

export class MessageWriter {
  constructor(db) {
    this.db = db;
    this.insertContact = db.prepare(`
      INSERT INTO contacts (id, source, native_id, display_name, handle, metadata_json, updated_at)
      VALUES (@id, @source, @native_id, @display_name, @handle, @metadata_json, @updated_at)
      ON CONFLICT(source, native_id) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, contacts.display_name),
        handle = COALESCE(excluded.handle, contacts.handle),
        metadata_json = COALESCE(excluded.metadata_json, contacts.metadata_json),
        updated_at = excluded.updated_at
    `);
    this.insertConversation = db.prepare(`
      INSERT INTO conversations (
        id, source, native_id, title, thread_type, last_message_at, last_preview,
        participant_count, metadata_json, updated_at
      ) VALUES (
        @id, @source, @native_id, @title, @thread_type, @last_message_at, @last_preview,
        @participant_count, @metadata_json, @updated_at
      )
      ON CONFLICT(source, native_id) DO UPDATE SET
        title = COALESCE(excluded.title, conversations.title),
        thread_type = excluded.thread_type,
        participant_count = COALESCE(excluded.participant_count, conversations.participant_count),
        metadata_json = COALESCE(excluded.metadata_json, conversations.metadata_json),
        updated_at = excluded.updated_at
    `);
    this.insertParticipant = db.prepare(`
      INSERT OR IGNORE INTO conversation_participants (conversation_id, contact_id)
      VALUES (?, ?)
    `);
    this.insertMessage = db.prepare(`
      INSERT INTO messages (
        id, conversation_id, source, native_id, sender_contact_id, direction,
        sent_at, ingested_at, message_type, body, reply_to_id, is_deleted, raw_json
      ) VALUES (
        @id, @conversation_id, @source, @native_id, @sender_contact_id, @direction,
        @sent_at, @ingested_at, @message_type, @body, @reply_to_id, @is_deleted, @raw_json
      )
      ON CONFLICT(source, native_id) DO UPDATE SET
        body = excluded.body,
        is_deleted = excluded.is_deleted,
        message_type = excluded.message_type,
        raw_json = excluded.raw_json,
        reply_to_id = COALESCE(excluded.reply_to_id, messages.reply_to_id),
        sender_contact_id = COALESCE(excluded.sender_contact_id, messages.sender_contact_id)
    `);
    this.rollupConversation = db.prepare(`
      UPDATE conversations
      SET last_message_at = @sent_at,
          last_preview = @preview,
          updated_at = @updated_at
      WHERE id = @id AND last_message_at <= @sent_at
    `);
    this.touchConversationActivity = db.prepare(`
      UPDATE conversations
      SET last_message_at = @sent_at,
          updated_at = @updated_at
      WHERE id = @id AND last_message_at <= @sent_at
    `);
  }

  upsertContact({ source, nativeId, displayName = null, handle = null, metadata = null }) {
    if (!isSource(source)) throw new Error(`invalid source: ${source}`);
    const id = entityId(source, nativeId);
    const updated_at = nowMs();
    runWithBusyRetry(() =>
      this.insertContact.run({
        id,
        source,
        native_id: String(nativeId),
        display_name: displayName,
        handle,
        metadata_json: metadata == null ? null : JSON.stringify(metadata),
        updated_at,
      }),
    );
    return id;
  }

  upsertConversation({
    source,
    nativeId,
    title = null,
    threadType = 'unknown',
    participantCount = null,
    metadata = null,
  }) {
    if (!isSource(source)) throw new Error(`invalid source: ${source}`);
    if (!THREAD_TYPES.includes(threadType)) throw new Error(`invalid threadType: ${threadType}`);
    const id = entityId(source, nativeId);
    const updated_at = nowMs();
    runWithBusyRetry(() =>
      this.insertConversation.run({
        id,
        source,
        native_id: String(nativeId),
        title: usableConversationTitle(title, nativeId),
        thread_type: threadType,
        last_message_at: 0,
        last_preview: null,
        participant_count: participantCount,
        metadata_json: metadata == null ? null : JSON.stringify(metadata),
        updated_at,
      }),
    );
    return id;
  }

  addParticipant(conversationId, contactId) {
    runWithBusyRetry(() => this.insertParticipant.run(conversationId, contactId));
  }

  upsertMessage({
    source,
    nativeId,
    conversationNativeId,
    senderNativeId = null,
    senderDisplayName = null,
    senderHandle = null,
    direction,
    sentAt,
    messageType = 'text',
    body = null,
    replyToNativeId = null,
    isDeleted = false,
    raw = null,
    conversationTitle = null,
    threadType = 'unknown',
  }) {
    if (!isSource(source)) throw new Error(`invalid source: ${source}`);
    if (!DIRECTIONS.includes(direction)) throw new Error(`invalid direction: ${direction}`);
    if (!MESSAGE_TYPES.includes(messageType)) throw new Error(`invalid messageType: ${messageType}`);

    const conversationId = this.upsertConversation({
      source,
      nativeId: conversationNativeId,
      title: conversationTitle,
      threadType,
    });

    let senderContactId = null;
    if (senderNativeId != null) {
      senderContactId = this.upsertContact({
        source,
        nativeId: senderNativeId,
        displayName: senderDisplayName,
        handle: senderHandle,
      });
      this.addParticipant(conversationId, senderContactId);
    }

    const id = entityId(source, nativeId);
    const ingested_at = nowMs();
    const reply_to_id = replyToNativeId ? entityId(source, replyToNativeId) : null;
    const raw_json = raw == null ? null : JSON.stringify(raw);

    runWithBusyRetry(() =>
      this.insertMessage.run({
        id,
        conversation_id: conversationId,
        source,
        native_id: String(nativeId),
        sender_contact_id: senderContactId,
        direction,
        sent_at: Number(sentAt),
        ingested_at,
        message_type: messageType,
        body,
        reply_to_id,
        is_deleted: isDeleted ? 1 : 0,
        raw_json,
      }),
    );

    if (messageType === 'reaction') {
      runWithBusyRetry(() =>
        this.touchConversationActivity.run({
          id: conversationId,
          sent_at: Number(sentAt),
          updated_at: ingested_at,
        }),
      );
    } else {
      runWithBusyRetry(() =>
        this.rollupConversation.run({
          id: conversationId,
          sent_at: Number(sentAt),
          preview: preview(body),
          updated_at: ingested_at,
        }),
      );
    }

    return id;
  }
}
