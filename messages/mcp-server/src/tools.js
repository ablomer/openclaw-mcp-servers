import { displayTime, escapeFtsQuery } from '@openclaw-messages/shared';
import { assertChatId, clampInt, optionalSource, resolveMessageRange, truncatePayload } from './validate.js';

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

const RESOLVED_TITLE_SQL = `
  CASE
    WHEN conv.title IS NOT NULL AND TRIM(conv.title) <> '' AND conv.title <> conv.native_id
      THEN conv.title
    ELSE peer.display_name
  END
`;

function displaySender(row) {
  if (row.direction === 'outbound') return 'You';
  return row.sender;
}

function formatRangeMessage(row) {
  return {
    id: row.id,
    sender: displaySender(row),
    direction: row.direction,
    sent_at: displayTime(row.sent_at),
    message_type: row.message_type,
    body: row.body,
    reply_to_id: row.reply_to_id,
  };
}

function groupByThread(rows) {
  const threads = [];
  const index = new Map();
  for (const row of rows) {
    let thread = index.get(row.chat_id);
    if (!thread) {
      thread = {
        chat_id: row.chat_id,
        source: row.source,
        title: row.title,
        thread_type: row.thread_type,
        messages: [],
      };
      index.set(row.chat_id, thread);
      threads.push(thread);
    }
    thread.messages.push(formatRangeMessage(row));
  }
  for (const thread of threads) {
    thread.messages.reverse();
  }
  return threads;
}

export function createTools(db, { nowMs } = {}) {
  const listStmt = db.prepare(`
    SELECT
      conv.id AS chat_id,
      conv.source,
      ${RESOLVED_TITLE_SQL} AS title,
      conv.thread_type,
      conv.last_message_at,
      conv.last_preview
    FROM conversations conv
    LEFT JOIN contacts peer
      ON peer.source = conv.source AND peer.native_id = conv.native_id
    WHERE conv.last_message_at > 0
      AND (? IS NULL OR conv.source = ?)
      AND (? IS NULL OR conv.last_message_at < ?)
    ORDER BY conv.last_message_at DESC
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

  const rangeStmt = db.prepare(`
    SELECT
      m.id,
      m.conversation_id AS chat_id,
      m.source,
      c.display_name AS sender,
      m.direction,
      m.sent_at,
      m.message_type,
      m.body,
      m.reply_to_id,
      ${RESOLVED_TITLE_SQL} AS title,
      conv.thread_type
    FROM messages m
    JOIN conversations conv ON conv.id = m.conversation_id
    LEFT JOIN contacts c ON c.id = m.sender_contact_id
    LEFT JOIN contacts peer
      ON peer.source = conv.source AND peer.native_id = conv.native_id
    WHERE m.sent_at >= ?
      AND m.sent_at < ?
      AND (? IS NULL OR m.source = ?)
      AND (? = 1 OR (m.body IS NOT NULL AND TRIM(m.body) <> ''))
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
        const rows = threadStmt.all(exists.id, before, before, lim).map((row) => ({
          ...row,
          sender: displaySender(row),
        }));
        return textResult({ messages: rows });
      } catch (err) {
        return errorResult(err.message || 'get_thread_history failed');
      }
    },

    listMessages({ from, to, days, today, source, limit, include_empty } = {}) {
      try {
        const window = resolveMessageRange(
          { from, to, days, today },
          { nowMs },
        );
        const src = optionalSource(source);
        const lim = clampInt(limit, 200, 1, 200);
        const includeEmpty = include_empty === true ? 1 : 0;
        const rows = rangeStmt.all(
          window.fromMs,
          window.toMsExclusive,
          src,
          src,
          includeEmpty,
          lim + 1,
        );
        const truncated = rows.length > lim;
        const kept = truncated ? rows.slice(0, lim) : rows;
        return textResult({
          from: window.from,
          to: window.to,
          truncated,
          threads: groupByThread(kept),
        });
      } catch (err) {
        return errorResult(err.message || 'list_messages failed');
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
          sender: displaySender(row),
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
