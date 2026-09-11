import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountFlags,
  calendarPrefix,
  emailPrefix,
  flagValue,
  parseGogResult,
  positionals,
  runGog,
} from '../src/gog.js';

const fixtures = dirname(fileURLToPath(import.meta.url));
const echoArgv = join(fixtures, 'fixtures/echo-argv.mjs');
const exitFail = join(fixtures, 'fixtures/exit-fail.mjs');
const sleep = join(fixtures, 'fixtures/sleep.mjs');

function parseStdout(result) {
  assert.equal(result.exitCode, 0);
  return JSON.parse(result.stdout);
}

test('runGog rejects a string command line', async () => {
  await assert.rejects(() => runGog('gmail search foo && send'), /argv array/);
});

test('runGog rejects non-string argv entries', async () => {
  await assert.rejects(() => runGog(['gmail', 1]), /must be strings/);
});

test('runGog passes a shell-looking query as one argv element', async () => {
  const query = 'foo && gog gmail send --to x';
  const result = await runGog([echoArgv, 'gmail', 'search', '--', query], {
    bin: process.execPath,
  });
  const payload = parseStdout(result);
  assert.deepEqual(payload.argv, ['gmail', 'search', '--', query]);
  assert.equal(payload.argv.filter((a) => a === 'send').length, 0);
});

test('runGog does not execute shell metacharacters', async () => {
  const result = await runGog([echoArgv, 'foo && echo pwned'], {
    bin: process.execPath,
  });
  const payload = parseStdout(result);
  assert.deepEqual(payload.argv, ['foo && echo pwned']);
  assert.equal(result.stdout.trim().split('\n').length, 1);
});

test('parseGogResult maps non-zero exit to an error', async () => {
  const result = await runGog([exitFail], { bin: process.execPath });
  const parsed = parseGogResult(result);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /command failed|exited 2/);
});

test('parseGogResult maps timeout', async () => {
  const result = await runGog([sleep], {
    bin: process.execPath,
    timeoutMs: 80,
  });
  assert.equal(result.timedOut, true);
  const parsed = parseGogResult(result);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'gog timed out');
});

test('parseGogResult parses JSON stdout', () => {
  const parsed = parseGogResult({
    exitCode: 0,
    stdout: '{"threads":[]}\n',
    stderr: '',
    timedOut: false,
  });
  assert.deepEqual(parsed, { ok: true, data: { threads: [] } });
});

test('parseGogResult redacts password-like stderr', () => {
  const parsed = parseGogResult({
    exitCode: 1,
    stdout: '',
    stderr: 'GOG_KEYRING_PASSWORD=supersecret boom',
    timedOut: false,
  });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.includes('supersecret'), false);
});

test('emailPrefix is read-only and cannot send', () => {
  const prefix = emailPrefix({ GOG_ACCOUNT: '' });
  assert.ok(prefix.includes('--readonly'));
  assert.ok(prefix.includes('--gmail-no-send'));
  assert.ok(prefix.includes('--enable-commands-exact'));
  assert.equal(
    prefix[prefix.indexOf('--enable-commands-exact') + 1],
    'gmail.search,gmail.get,gmail.thread.get,gmail.labels.list',
  );
  assert.equal(prefix.includes('gmail.send'), false);
  assert.equal(
    prefix.includes('--sanitize-content'),
    false,
    'sanitize-content is a gmail get/thread flag, not a global gog flag',
  );
  assert.equal(prefix.includes('--wrap-untrusted'), false);
  assert.deepEqual(accountFlags({}), []);
});

test('emailPrefix pins GOG_ACCOUNT from env, not tool args', () => {
  const prefix = emailPrefix({ GOG_ACCOUNT: 'me@example.com' });
  const i = prefix.indexOf('--account');
  assert.ok(i >= 0);
  assert.equal(prefix[i + 1], 'me@example.com');
});

test('calendarPrefix allowlists events and disables admin commands', () => {
  const prefix = calendarPrefix({});
  const enabled = prefix[prefix.indexOf('--enable-commands-exact') + 1];
  const disabled = prefix[prefix.indexOf('--disable-commands') + 1];
  assert.match(enabled, /calendar.create/);
  assert.equal(enabled.includes('create-calendar'), false);
  assert.match(disabled, /create-calendar/);
  assert.match(disabled, /delete-calendar/);
  assert.match(disabled, /acl/);
  assert.equal(prefix.includes('--readonly'), false);
  assert.equal(prefix.includes('--wrap-untrusted'), false);
});

test('flagValue and positionals keep user strings as discrete slots', () => {
  assert.deepEqual(flagValue('--summary', '--force'), ['--summary', '--force']);
  assert.deepEqual(flagValue('--summary', ''), []);
  assert.deepEqual(positionals('--account evil@x', 'id'), [
    '--',
    '--account evil@x',
    'id',
  ]);
});
