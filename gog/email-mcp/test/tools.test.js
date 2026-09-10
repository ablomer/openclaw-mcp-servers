import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../src/tools.js';

function fakeRunner() {
  const calls = [];
  const runGog = async (args) => {
    calls.push(args);
    return { exitCode: 0, stdout: '{"ok":true}', stderr: '', timedOut: false };
  };
  return { calls, tools: createTools({ runGog }) };
}

function parse(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

function afterDash(args) {
  const i = args.indexOf('--');
  assert.ok(i >= 0, 'expected -- before positionals');
  return args.slice(i + 1);
}

test('search_messages puts a shell-looking query in one argv slot after --', async () => {
  const { calls, tools } = fakeRunner();
  const query = 'foo && gog gmail send --to x';
  const payload = parse(await tools.searchMessages({ query, max: 7 }));
  assert.deepEqual(payload, { ok: true });

  const args = calls[0];
  assert.ok(args.includes('--readonly'));
  assert.ok(args.includes('--gmail-no-send'));
  assert.equal(args.includes('--sanitize-content'), false);
  assert.deepEqual(afterDash(args), [query]);
  assert.equal(args.filter((a) => a === 'send').length, 0);
  assert.equal(args[args.indexOf('--max') + 1], '7');
  assert.ok(args.includes('gmail'));
  assert.ok(args.includes('search'));
});

test('search_messages keeps a flag-shaped query as one value after --', async () => {
  const { calls, tools } = fakeRunner();
  const query = '--account evil@x';
  await tools.searchMessages({ query });
  const args = calls[0];
  assert.deepEqual(afterDash(args), [query]);
  assert.equal(
    args.filter((a) => a === '--account').length,
    0,
    'query must not become a --account flag',
  );
});

test('get_message and get_thread never emit send', async () => {
  const { calls, tools } = fakeRunner();
  await tools.getMessage({ id: 'm1', format: 'metadata' });
  await tools.getThread({ id: 't1' });
  for (const args of calls) {
    assert.ok(args.includes('--readonly'));
    assert.equal(args.filter((a) => a === 'send').length, 0);
    const cmd = args.indexOf('gmail');
    const sanitize = args.indexOf('--sanitize-content');
    assert.ok(sanitize > cmd, 'sanitize-content must follow gmail get/thread');
  }
  assert.deepEqual(afterDash(calls[0]), ['m1']);
  assert.equal(calls[0][calls[0].indexOf('--format') + 1], 'metadata');
  assert.deepEqual(afterDash(calls[1]), ['t1']);
  assert.ok(calls[1].includes('thread'));
});

test('list_labels is read-only and has no positionals', async () => {
  const { calls, tools } = fakeRunner();
  await tools.listLabels();
  const args = calls[0];
  assert.ok(args.includes('--readonly'));
  assert.deepEqual(args.slice(-3), ['gmail', 'labels', 'list']);
  assert.equal(args.includes('send'), false);
  assert.equal(args.includes('--sanitize-content'), false);
});

test('payload over 32KiB is truncated', async () => {
  const tools = createTools({
    runGog: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ body: 'x'.repeat(40_000) }),
      stderr: '',
      timedOut: false,
    }),
  });
  const result = await tools.getMessage({ id: 'm1' });
  const payload = parse(result);
  assert.equal(payload.truncated, true);
});

test('gog errors become isError results', async () => {
  const tools = createTools({
    runGog: async () => ({
      exitCode: 3,
      stdout: '',
      stderr: 'empty search',
      timedOut: false,
    }),
  });
  const result = await tools.searchMessages({ query: 'x' });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'empty search');
});
