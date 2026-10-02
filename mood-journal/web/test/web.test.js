import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '@openclaw-mood-journal/shared';
import { signSession, verifySession } from '../src/auth.js';
import { createApp } from '../src/app.js';

const PASSWORD = 'correct-horse';
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [];

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function cookieFrom(res) {
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  const raw = cookies.find((value) => value.startsWith('mj_session='));
  assert.ok(raw, 'expected mj_session cookie');
  return raw.split(';')[0];
}

async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mood-journal-web-'));
  dirs.push(dir);
  const db = migrate(join(dir, 'mood-journal.sqlite'));
  const app = createApp({ db, password: PASSWORD });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    db.close();
  }
}

async function login(base, password = PASSWORD, headers = {}) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ password }),
  });
  return res;
}

function authed(cookie) {
  return { cookie };
}

test('verifySession rejects a tampered or expired cookie', () => {
  const token = signSession(PASSWORD, 1_000);
  assert.equal(verifySession(token, PASSWORD, 1_000), true);
  assert.equal(verifySession(token, PASSWORD, Number(token.split('.')[0]) + 1), false);
  assert.equal(verifySession(`${token}x`, PASSWORD, 1_000), false);
  assert.equal(verifySession(token, 'other-password', 1_000), false);
});

test('server exits when the password is missing', async () => {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: webRoot,
    env: { ...process.env, MOOD_JOURNAL_WEB_PASSWORD: '' },
  });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  assert.equal(code, 1);
});

test('login rejects a missing or wrong password and accepts the right one', async () => {
  await withServer(async (base) => {
    const missing = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(missing.status, 401);
    const wrong = await login(base, 'nope');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('set-cookie'), null);

    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="app"/);

    const ok = await login(base, PASSWORD, { 'x-forwarded-proto': 'https' });
    assert.equal(ok.status, 204);
    const setCookie = cookieFrom(ok);
    assert.match(setCookie, /^mj_session=/);
    assert.match(ok.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(ok.headers.get('set-cookie'), /Secure/i);
    assert.match(ok.headers.get('set-cookie'), /SameSite=Lax/i);

    const entries = await fetch(`${base}/api/entries`, { headers: authed(setCookie) });
    assert.equal(entries.status, 200);
    assert.deepEqual(await entries.json(), { entries: [], next_before: null });

    const loggedOut = await fetch(`${base}/logout`, { method: 'POST', headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(loggedOut.status, 204);
    const cleared = loggedOut.headers.get('set-cookie');
    assert.match(cleared, /mj_session=/);
    assert.match(cleared, /Max-Age=0/i);
    assert.match(cleared, /Secure/i);
  });
});

test('unauthenticated api routes return 401', async () => {
  await withServer(async (base) => {
    const paths = [
      ['GET', '/api/entries'],
      ['POST', '/api/entries'],
      ['GET', '/api/tags'],
      ['PATCH', '/api/entries/00000000-0000-4000-8000-000000000001'],
      ['DELETE', '/api/entries/00000000-0000-4000-8000-000000000001'],
    ];
    for (const [method, path] of paths) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });
});

test('eight bad logins are rejected and the next is limited', async () => {
  await withServer(async (base) => {
    for (let i = 0; i < 8; i += 1) {
      const res = await login(base, 'nope');
      assert.equal(res.status, 401);
    }
    const limited = await login(base, PASSWORD);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error, 'too_many_attempts');
  });
});

test('create, read, update when, list, search, and soft-delete', async () => {
  await withServer(async (base) => {
    const loggedIn = await login(base);
    const cookie = cookieFrom(loggedIn);
    const headers = { ...authed(cookie), 'content-type': 'application/json' };

    async function send(path, { expect = 200, ...options } = {}) {
      const res = await fetch(`${base}${path}`, { ...options, headers: { ...headers, ...options.headers } });
      const text = await res.text();
      const body = text ? JSON.parse(text) : null;
      assert.equal(res.status, expect, text);
      return body;
    }

    const created = await send('/api/entries', {
      method: 'POST',
      expect: 201,
      body: JSON.stringify({
        mood: 8,
        note: 'morning walk in the park felt great',
        energy: 7,
        tags: ['Walk', 'park'],
        when: '2026-09-07T12:00',
        recorded_at: 1,
      }),
    });
    assert.equal(created.entry.when, '2026-09-07T12:00');
    assert.equal(created.entry.mood, 8);
    assert.deepEqual(created.entry.tags, ['park', 'walk']);
    assert.equal(created.entry.recorded_at, undefined);
    assert.equal(created.entry.created_at, undefined);
    assert.match(created.entry.display_recorded_at, /2026-09-07/);

    const fetched = await send(`/api/entries/${created.entry.id}`);
    assert.equal(fetched.entry.note, 'morning walk in the park felt great');

    const updated = await send(`/api/entries/${created.entry.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'morning walk in the park felt great still',
        when: '2026-09-08T15:30',
      }),
    });
    assert.equal(updated.entry.when, '2026-09-08T15:30');
    assert.equal(updated.entry.mood, 8);
    assert.deepEqual(updated.entry.tags, ['park', 'walk']);

    const kept = await send(`/api/entries/${created.entry.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ energy: 6 }),
    });
    assert.equal(kept.entry.when, '2026-09-08T15:30');
    assert.equal(kept.entry.energy, 6);

    const other = await send('/api/entries', {
      method: 'POST',
      expect: 201,
      body: JSON.stringify({
        mood: 3,
        note: 'heavy rain and a headache',
        when: '2026-09-01T09:00',
      }),
    });

    const day = await send('/api/entries?from=2026-09-08&to=2026-09-08');
    assert.deepEqual(day.entries.map((entry) => entry.id), [created.entry.id]);

    const found = await send('/api/entries?q=morning%20walk');
    assert.equal(found.entries.length, 1);
    assert.equal(found.entries[0].id, created.entry.id);

    const tags = await send('/api/tags');
    assert.deepEqual(tags.tags, ['park', 'walk']);

    const removed = await send(`/api/entries/${other.entry.id}`, { method: 'DELETE' });
    assert.equal(removed.deleted, true);
    const gone = await fetch(`${base}/api/entries/${other.entry.id}`, { headers });
    assert.equal(gone.status, 404);
    const remaining = await send('/api/entries');
    assert.equal(remaining.entries.some((entry) => entry.id === other.entry.id), false);
    assert.equal(remaining.entries.some((entry) => entry.id === created.entry.id), true);
  });
});

test('list pages with a before cursor', async () => {
  await withServer(async (base) => {
    const cookie = cookieFrom(await login(base));
    const headers = { cookie, 'content-type': 'application/json' };
    for (let i = 0; i < 31; i += 1) {
      const minute = String(i).padStart(2, '0');
      const res = await fetch(`${base}/api/entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ mood: 5, note: `page entry ${minute}`, when: `2026-03-01T12:${minute}` }),
      });
      assert.equal(res.status, 201);
    }
    const first = await fetch(`${base}/api/entries`, { headers });
    const page = await first.json();
    assert.equal(page.entries.length, 30);
    assert.equal(page.entries[0].when, '2026-03-01T12:30');
    assert.ok(page.next_before);
    const second = await fetch(`${base}/api/entries?before=${encodeURIComponent(page.next_before)}`, { headers });
    const rest = await second.json();
    assert.equal(rest.entries.length, 1);
    assert.equal(rest.entries[0].when, '2026-03-01T12:00');
    assert.equal(rest.next_before, null);
  });
});
