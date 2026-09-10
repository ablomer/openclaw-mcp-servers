import { escapeFtsQuery } from '@openclaw-messages/shared';
import { assertChatId, clampInt, optionalSource, truncatePayload } from './validate.js';

function textResult(payload) {
  return {
    content: [{ type: 'text', text: truncatePayload(payload) }],
  };
}

function errorResult(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

export function createTools(db) {
  const listStmt = db.prepare(`
    SELECT id AS chat_id, source, title, thread_type, last_message_at, last_preview
    FROM conversations
    WHERE last_message_at > 0
      AND (? IS NULL OR source = ?)
      AND (? IS NULL OR last_message_at < ?)
    ORDER BY last_message_at DESC
    LIMIT ?
  `);

  const threadExistsStmt = db.prepare('SELECT id FROM conversations WHERE id = ?');

  const threadStmt = db.prepare(`
    SELECT
      m.id,
      m.conversation_id AS chat_id,
      m.source,
      c.display_name AS sender,
      m.direction,
      m.sent_at,
      m.message_type,
      m.body,
      m.reply_to_id
    FROM messages m
    LEFT JOIN contacts c ON c.id = m.sender_contact_id
    WHERE m.conversation_id = ?
      AND (? IS NULL OR m.sent_at < ?)
    ORDER BY m.sent_at DESC
    LIMIT ?
  `);

  const searchStmt = db.prepare(`
    SELECT
      m.id,
      m.conversation_id AS chat_id,
      m.source,
      c.display_name AS sender,
      m.direction,
      m.sent_at,
      m.message_type,
      snippet(messages_fts, 0, '', '', '…', 16) AS snippet,
      m.body
    FROM messages_fts
    JOIN messages m ON m.rowid = messages_fts.rowid
    LEFT JOIN contacts c ON c.id = m.sender_contact_id
    WHERE messages_fts MATCH ?
      AND (? IS NULL OR m.source = ?)
      AND (? IS NULL OR m.conversation_id = ?)
      AND (? IS NULL OR m.sent_at < ?)
    ORDER BY m.sent_at DESC
    LIMIT ?
  `);

  return {
    listRecentConversations({ source, limit, before_ts } = {}) {
      try {
        const src = optionalSource(source);
        const lim = clampInt(limit, 20, 1, 50);
        const before = before_ts == null ? null : Number(before_ts);
        const rows = listStmt.all(src, src, before, before, lim);
        return textResult({ conversations: rows });
      } catch (err) {
        return errorResult(err.message || 'list_recent_conversations failed');
      }
    },

    getThreadHistory({ chat_id, limit, before_ts } = {}) {
      try {
        const parsed = assertChatId(chat_id);
        const exists = threadExistsStmt.get(`${parsed.source}:${parsed.nativeId}`);
        if (!exists) {
          return errorResult('Unknown chat_id');
        }
        const lim = clampInt(limit, 50, 1, 200);
        const before = before_ts == null ? null : Number(before_ts);
        const rows = threadStmt.all(exists.id, before, before, lim);
        return textResult({ messages: rows });
      } catch (err) {
        return errorResult(err.message || 'get_thread_history failed');
      }
    },

    searchMessages({ query, source, chat_id, limit, before_ts } = {}) {
      try {
        const match = escapeFtsQuery(query);
        const src = optionalSource(source);
        const chat = chat_id == null || chat_id === '' ? null : assertChatId(chat_id);
        const chatId = chat ? `${chat.source}:${chat.nativeId}` : null;
        const lim = clampInt(limit, 20, 1, 50);
        const before = before_ts == null ? null : Number(before_ts);
        const rows = searchStmt.all(match, src, src, chatId, chatId, before, before, lim).map((row) => ({
          id: row.id,
          chat_id: row.chat_id,
          source: row.source,
          sender: row.sender,
          direction: row.direction,
          sent_at: row.sent_at,
          message_type: row.message_type,
          snippet: row.snippet,
        }));
        return textResult({ results: rows });
      } catch (err) {
        return errorResult(err.message || 'search_messages failed');
      }
    },
  };
}
