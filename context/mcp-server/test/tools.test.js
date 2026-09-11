import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGenerator,
  extractCalendarEvents,
  extractEmailBody,
  extractEmailThreads,
  pickDefaultCalendarId,
} from '../src/generate.js';
import { createTools } from '../src/tools.js';
import { callMcpTool } from '../src/mcp-client.js';
import { truncatePayload } from '../src/validate.js';

const workspaceDir = await mkdtemp(join(tmpdir(), 'context-mcp-'));
const memoryDir = join(workspaceDir, 'memory');
await mkdir(memoryDir);

after(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

const NOW = new Date('2026-09-10T15:00:00-04:00');

function parse(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

function fakeCallTool(handlers) {
  const calls = [];
  const callTool = async (url, toolName, args) => {
    calls.push({ url, toolName, args });
    const key = `${url}|${toolName}`;
    const handler = handlers[key] || handlers[toolName];
    if (!handler) return { error: `unexpected ${toolName} on ${url}` };
    return handler(args);
  };
  return { calls, callTool };
}

function generatorWith(handlers, extra = {}) {
  const { calls, callTool } = fakeCallTool(handlers);
  const generator = createGenerator({
    workspaceDir,
    messagesUrl: 'http://messages-mcp:3000/mcp',
    calendarUrl: 'http://calendar-mcp:3000/mcp',
    emailUrl: 'http://email-mcp:3000/mcp',
    callTool,
    now: () => NOW,
    ...extra,
  });
  return { calls, generator };
}

test('pickDefaultCalendarId prefers primary, then first id', () => {
  assert.equal(
    pickDefaultCalendarId({
      items: [
        { id: 'other@example.com' },
        { id: 'me@example.com', primary: true },
      ],
    }),
    'me@example.com',
  );
  assert.equal(pickDefaultCalendarId({ calendars: [{ calendar_id: 'first' }] }), 'first');
  assert.equal(pickDefaultCalendarId({ items: [] }), null);
});

test('extractCalendarEvents and extractEmailThreads unwrap nested payloads', () => {
  assert.deepEqual(extractCalendarEvents({ events: [{ summary: 'A' }] }), [{ summary: 'A' }]);
  assert.deepEqual(extractCalendarEvents({ items: [{ summary: 'B' }] }), [{ summary: 'B' }]);
  assert.deepEqual(extractEmailThreads({ threads: [{ id: 't1' }] }), [{ id: 't1' }]);
  assert.deepEqual(extractEmailThreads({ result: { messages: [{ id: 'm1' }] } }), [{ id: 'm1' }]);
});

test('extractEmailBody prefers the longest usable body and skips 32KiB stubs', () => {
  const body = extractEmailBody({
    snippet: 'short',
    reason: 'ok',
    nested: { body: 'a longer email body with more text' },
  });
  assert.equal(body, 'a longer email body with more text');
  assert.equal(extractEmailBody({ reason: 'payload exceeded 32KiB cap', body: 'hidden' }), '');
});

test('getMemories reads MEMORY.md and the last three daily logs', async () => {
  await writeFile(join(workspaceDir, 'MEMORY.md'), '  I live in Brooklyn.\n');
  await writeFile(join(memoryDir, '2026-09-10.md'), 'Today: shipped context MCP\n');
  await writeFile(join(memoryDir, '2026-09-08.md'), 'Two days ago\n');

  const { generator } = generatorWith({});
  const memories = await generator.getMemories();
  assert.equal(memories.long_term, 'I live in Brooklyn.');
  assert.deepEqual(
    memories.daily_logs.map((log) => log.date),
    ['2026-09-10', '2026-09-08'],
  );
  assert.equal(memories.daily_logs[0].content, 'Today: shipped context MCP');
  assert.equal(
    memories.daily_logs.some((log) => log.date === '2026-09-09'),
    false,
  );
});

test('getMessages formats threads and outbound senders', async () => {
  const { calls, generator } = generatorWith({
    list_messages: () => ({
      threads: [
        {
          title: 'Ada',
          source: 'whatsapp',
          thread_type: 'dm',
          messages: [
            { direction: 'inbound', sender: 'Ada', sent_at: '2026-09-10 10:00', body: 'hi' },
            { direction: 'outbound', sender: 'you', sent_at: '2026-09-10 10:01', body: 'hey' },
          ],
        },
        {
          title: 'Project',
          source: 'gmessages',
          thread_type: 'group',
          messages: [{ sender: 'x@s.whatsapp.net', sent_at: 'noon', body: 'ping' }],
        },
      ],
    }),
  });

  const payload = await generator.getMessages();
  assert.equal(calls[0].args.days, 3);
  assert.equal(calls[0].args.limit, 30);
  assert.deepEqual(payload.threads[0], {
    title: 'Ada',
    source: 'whatsapp',
    thread_type: 'dm',
    messages: [
      { sender: 'Ada', sent_at: '2026-09-10 10:00', body: 'hi' },
      { sender: 'You', sent_at: '2026-09-10 10:01', body: 'hey' },
    ],
  });
  assert.deepEqual(payload.threads[1], {
    title: 'Project',
    source: 'gmessages',
    thread_type: 'group',
    messages: [{ sender: 'x@s.whatsapp.net', sent_at: 'noon', body: 'ping' }],
  });
});

test('getMessages records MCP errors instead of throwing', async () => {
  const { generator } = generatorWith({
    list_messages: () => ({ error: 'messages down' }),
  });
  const payload = await generator.getMessages();
  assert.deepEqual(payload, { error: 'messages down', threads: [] });
});

test('getCalendar lists the next two events on the default calendar', async () => {
  const { calls, generator } = generatorWith({
    list_events: () => ({
      events: [
        {
          summary: 'Standup',
          start: { dateTime: '2026-09-11T09:00:00-04:00' },
          end: { dateTime: '2026-09-11T09:30:00-04:00' },
          description: 'daily',
        },
      ],
    }),
  });

  const payload = await generator.getCalendar();
  assert.equal(calls[0].toolName, 'list_events');
  assert.deepEqual(calls[0].args, { days: 30, max: 2 });
  assert.deepEqual(payload.events[0], {
    summary: 'Standup',
    start: '2026-09-11T09:00:00-04:00',
    end: '2026-09-11T09:30:00-04:00',
    notes: 'daily',
  });
});

test('getInbox fetches bodies in parallel and falls back to snippets', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const { calls, generator } = generatorWith({
    search_messages: () => ({
      threads: [
        {
          subject: 'Invoice',
          from: 'billing@example.com',
          date: '2026-09-01',
          messageId: 'm1',
        },
        {
          subject: 'Hello',
          from: 'ada@example.com',
          date: '2026-08-20',
          threadId: 't2',
          snippet: 'see you soon',
        },
        {
          subject: 'Third',
          from: 'z@example.com',
          date: '2026-08-19',
          messageId: 'm3',
          snippet: 'later',
        },
      ],
    }),
    get_message: async ({ id }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      if (id === 'm1') return { body: 'Please pay $20' };
      if (id === 'm3') return { body: 'third body' };
      return { error: 'not found' };
    },
    get_thread: () => {
      throw new Error('get_thread should not be called');
    },
  });

  const payload = await generator.getInbox();
  assert.equal(calls[0].args.query, 'in:inbox newer_than:3m');
  assert.equal(calls.filter((c) => c.toolName === 'get_thread').length, 0);
  assert.ok(maxInFlight > 1, 'email bodies should fetch concurrently');
  assert.equal(payload.threads[0].subject, 'Invoice');
  assert.equal(payload.threads[0].body, 'Please pay $20');
  assert.equal(payload.threads[1].subject, 'Hello');
  assert.equal(payload.threads[1].body, 'see you soon');
  assert.equal(payload.threads[2].body, 'third body');
});

test('getInbox uses snippets when the time budget is exhausted', async () => {
  const { calls, generator } = generatorWith(
    {
      search_messages: () => ({
        threads: [
          {
            subject: 'Stale',
            from: 'ada@example.com',
            snippet: 'from search',
            messageId: 'm9',
          },
        ],
      }),
      get_message: () => {
        throw new Error('get_message should not be called after budget');
      },
    },
    { budgetMs: 0 },
  );

  const payload = await generator.getInbox();
  assert.equal(calls.filter((c) => c.toolName === 'get_message').length, 0);
  assert.equal(payload.threads[0].body, 'from search');
});

test('generate assembles all four sections', async () => {
  await writeFile(join(workspaceDir, 'MEMORY.md'), 'remember this');
  const { generator } = generatorWith({
    list_messages: () => ({ threads: [] }),
    list_events: () => ({ events: [] }),
    search_messages: () => ({ threads: [] }),
  });

  const payload = await generator.generate();
  assert.equal(payload.generated_at, NOW.toISOString());
  assert.equal(payload.memories.long_term, 'remember this');
  assert.deepEqual(payload.messages.threads, []);
  assert.deepEqual(payload.calendar.events, []);
  assert.deepEqual(payload.inbox.threads, []);
});

test('generateContext tool returns structured JSON', async () => {
  const { generator } = generatorWith({
    list_messages: () => ({ threads: [] }),
    list_events: () => ({ error: 'calendar down' }),
    search_messages: () => ({ error: 'empty inbox' }),
  });
  const tools = createTools({ generator });
  const payload = parse(await tools.generateContext());
  assert.equal(payload.generated_at, NOW.toISOString());
  assert.deepEqual(payload.calendar, { error: 'calendar down', events: [] });
  assert.deepEqual(payload.inbox, { threads: [] });
});

test('generateContext tool errors become isError results', async () => {
  const tools = createTools({
    generator: {
      async generate() {
        throw new Error('boom');
      },
    },
  });
  const result = await tools.generateContext();
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'boom');
});

test('truncatePayload replaces oversized JSON with a 256KiB stub', () => {
  const stub = JSON.parse(truncatePayload({ blob: 'x'.repeat(300_000) }));
  assert.equal(stub.truncated, true);
  assert.equal(stub.reason, 'payload exceeded 256KiB cap');
  assert.ok(stub.bytes > 262_144);
});

test('callMcpTool parses JSON and SSE tool results', async () => {
  const jsonFetch = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: '{"ok":true}' }] },
      });
    },
  });
  assert.deepEqual(await callMcpTool('http://messages-mcp:3000/mcp', 'list_messages', {}, jsonFetch), {
    ok: true,
  });

  const sseFetch = async () => ({
    ok: true,
    async text() {
      return 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"n\\":1}"}]}}\n\n';
    },
  });
  assert.deepEqual(await callMcpTool('http://email-mcp:3000/mcp', 'search_messages', {}, sseFetch), {
    n: 1,
  });
});

test('callMcpTool times out hung fetches', async () => {
  const hung = () => new Promise(() => {});
  const result = await callMcpTool('http://x', 'list_events', {}, hung, { timeoutMs: 30 });
  assert.match(result.error, /timed out after 30ms/);
});

test('callMcpTool surfaces HTTP, RPC, and tool errors', async () => {
  const httpFetch = async () => ({
    ok: false,
    status: 502,
    async text() {
      return 'bad gateway';
    },
  });
  assert.match((await callMcpTool('http://x', 't', {}, httpFetch)).error, /HTTP 502/);

  const rpcFetch = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({ error: { message: 'nope' } });
    },
  });
  assert.equal((await callMcpTool('http://x', 't', {}, rpcFetch)).error, 'nope');

  const toolFetch = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({
        result: { isError: true, content: [{ type: 'text', text: 'denied' }] },
      });
    },
  });
  assert.equal((await callMcpTool('http://x', 't', {}, toolFetch)).error, 'Tool returned error: denied');
});
