import { callMcpTool } from './mcp-client.js';

function looksLikeAddress(value) {
  return /@(?:lid|g\.us|s\.whatsapp\.net|broadcast|newsletter)$/i.test(String(value || ''));
}

function humanLabel(value) {
  const text = String(value || '').trim();
  if (!text || looksLikeAddress(text)) return null;
  return text;
}

function threadMeta(thread) {
  const title = humanLabel(thread.title) || thread.title || 'Unknown';
  return {
    title,
    source: thread.source || 'unknown',
    thread_type: thread.thread_type || null,
  };
}

function messageSender(msg, thread) {
  if (msg.direction === 'outbound') return 'You';
  const named = humanLabel(msg.sender);
  if (named) return named;
  if (thread.thread_type === 'dm') {
    const title = humanLabel(thread.title);
    if (title) return title;
  }
  return msg.sender || 'Unknown';
}

/**
 * gog does not accept the Google alias "primary". Prefer the calendar marked
 * primary in list_calendars (usually the account email), else the first id.
 */
export function pickDefaultCalendarId(payload) {
  const items = Array.isArray(payload)
    ? payload
    : payload?.items || payload?.calendars || payload?.result || [];
  if (!Array.isArray(items) || items.length === 0) return null;
  const primary = items.find((c) => c && (c.primary === true || c.primary === 'true'));
  const chosen = primary || items[0];
  if (!chosen || typeof chosen !== 'object') return null;
  return chosen.id || chosen.calendar_id || chosen.calendarId || null;
}

/**
 * gog calendar events JSON uses an `events` array; the Google API uses `items`.
 */
export function extractCalendarEvents(payload) {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.result)) return payload.result;
  if (payload.result && typeof payload.result === 'object') {
    return extractCalendarEvents(payload.result);
  }
  return [];
}

/**
 * gog gmail search JSON uses a `threads` array (inbox is conversation-grouped).
 */
export function extractEmailThreads(payload) {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.threads)) return payload.threads;
  if (Array.isArray(payload.messages)) return payload.messages;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.result)) return payload.result;
  if (payload.result && typeof payload.result === 'object') {
    return extractEmailThreads(payload.result);
  }
  return [];
}

export function emailThreadFields(row) {
  const first = Array.isArray(row.messages) && row.messages.length > 0 ? row.messages[0] : null;
  const last = Array.isArray(row.messages) && row.messages.length > 0
    ? row.messages[row.messages.length - 1]
    : null;
  return {
    subject: row.subject || last?.subject || first?.subject || '(No subject)',
    from: row.from || row.sender || last?.from || first?.from || last?.sender || first?.sender || 'Unknown',
    date: row.date || row.internalDate || last?.date || first?.date || last?.internalDate || first?.internalDate || '',
    snippet: row.snippet || last?.snippet || first?.snippet || '',
    threadId: row.threadId || row.thread_id || row.id || last?.threadId || first?.threadId || '',
    messageId: row.messageId || row.message_id || last?.id || first?.id || '',
  };
}

function oneLine(value, maxLen) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > maxLen ? clean.substring(0, maxLen) + '...' : clean;
}

function latestBodiesMapText(bodies) {
  if (!bodies || typeof bodies !== 'object' || Array.isArray(bodies)) return '';
  const values = Object.values(bodies).filter((value) => typeof value === 'string' && value.trim());
  return values.length ? values[values.length - 1] : '';
}

function coerceEmailText(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  if (typeof value.text === 'string') return value.text.trim();
  if (typeof value.body === 'string') return value.body.trim();
  if (typeof value.data === 'string') return value.data.trim();
  return '';
}

export function extractEmailBody(payload) {
  const texts = [];
  const seen = new Set();

  const visit = (node) => {
    if (node == null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.reason === 'payload exceeded 32KiB cap') return;

    const mapped = latestBodiesMapText(node.bodies);
    if (mapped) texts.push(mapped);

    for (const key of ['body', 'text', 'plain', 'snippet', 'bodyText', 'body_text']) {
      const text = coerceEmailText(node[key]);
      if (text) texts.push(text);
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
      } else if (value && typeof value === 'object') {
        visit(value);
      }
    }
  };

  visit(payload);
  texts.sort((a, b) => b.length - a.length);
  return texts[0] || '';
}

export async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createGenerator(options = {}) {
  const messagesUrl = options.messagesUrl || process.env.MESSAGES_MCP_URL || 'http://messages-mcp:3000/mcp';
  const calendarUrl = options.calendarUrl || process.env.CALENDAR_MCP_URL || 'http://calendar-mcp:3000/mcp';
  const emailUrl = options.emailUrl || process.env.EMAIL_MCP_URL || 'http://email-mcp:3000/mcp';
  const callTool = options.callTool || callMcpTool;
  const nowFn = options.now || (() => new Date());
  const budgetMs = options.budgetMs ?? 45_000;
  const emailConcurrency = options.emailConcurrency ?? 6;
  const startedAt = Date.now();

  async function getMessages() {
    const result = await callTool(messagesUrl, 'list_messages', { days: 3, limit: 30 });
    if (result.error) {
      return { error: result.error, threads: [] };
    }

    const payload = {
      threads: (result.threads || []).map((thread) => ({
        ...threadMeta(thread),
        messages: (thread.messages || []).map((msg) => ({
          sender: messageSender(msg, thread),
          sent_at: msg.sent_at || null,
          body: msg.body || null,
        })),
      })),
    };
    if (result.truncated) payload.truncated = true;
    return payload;
  }

  async function getCalendar() {
    const result = await callTool(calendarUrl, 'list_events', {
      days: 30,
      max: 2,
    });

    if (result.error) {
      return { error: result.error, events: [] };
    }

    return {
      events: extractCalendarEvents(result).map((event) => ({
        summary: event.summary || 'Untitled Event',
        start: event.start?.dateTime || event.start?.date || null,
        end: event.end?.dateTime || event.end?.date || null,
        notes: event.description ? oneLine(event.description, 100) : null,
      })),
    };
  }

  async function fetchEmailBody(thread) {
    const { threadId, messageId, snippet } = emailThreadFields(thread);
    if (Date.now() - startedAt >= budgetMs) {
      return { body: snippet || null, error: null };
    }

    const id = messageId || threadId;
    if (!id) return { body: snippet || null, error: null };

    const messageResult = await callTool(emailUrl, 'get_message', { id, format: 'full' });
    const fromMessage = extractEmailBody(messageResult);
    if (fromMessage) return { body: fromMessage, error: null };
    if (snippet) return { body: snippet, error: null };
    return { body: null, error: messageResult.error || null };
  }

  async function getInbox() {
    const result = await callTool(emailUrl, 'search_messages', {
      query: 'in:inbox newer_than:3m',
      max: 20,
    });

    if (result.error) {
      if (/empty/i.test(result.error)) {
        return { threads: [] };
      }
      return { error: result.error, threads: [] };
    }

    const rows = extractEmailThreads(result);
    if (result.truncated && result.reason === 'payload exceeded 32KiB cap' && !rows.length) {
      return { truncated: true, reason: result.reason, threads: [] };
    }

    const fetched = await mapPool(rows, emailConcurrency, (thread) => fetchEmailBody(thread));
    const payload = {
      threads: rows.map((thread, i) => {
        const { subject, from, date } = emailThreadFields(thread);
        const item = {
          subject,
          from: from || null,
          date: date || null,
          body: oneLine(fetched[i].body, 300) || null,
        };
        if (fetched[i].error) item.error = fetched[i].error;
        return item;
      }),
    };
    if (result.truncated) payload.truncated = true;
    return payload;
  }

  async function generate() {
    const [messages, calendar, inbox] = await Promise.all([
      getMessages(),
      getCalendar(),
      getInbox(),
    ]);

    return {
      generated_at: nowFn().toISOString(),
      messages,
      calendar,
      inbox,
    };
  }

  return {
    generate,
    getMessages,
    getCalendar,
    getInbox,
  };
}
