import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/migrate.js';
import { JournalWriter } from '../src/writer.js';
import { escapeFtsQuery } from '../src/fts.js';
import { logEvent } from '../src/log.js';
import { displayRecordedAt, parseDateArg, periodKey, zonedLocalToUtcMs } from '../src/time.js';
import { formatEntry } from '../src/format.js';
import { normalizeTags } from '../src/fields.js';

const dir = mkdtempSync(join(tmpdir(), 'mood-journal-shared-'));
const dbPath = join(dir, 'mood-journal.sqlite');

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('display_recorded_at formats America/New_York and round-trips', () => {
  const ms = Date.UTC(2026, 8, 7, 17, 10, 32);
  const display = displayRecordedAt(ms);
  assert.match(display, /2026-09-07 1:10:32 PM EDT$/);
  assert.match(display, /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), /);
  assert.equal(parseDateArg(display), ms);
});

test('parseDateArg interprets calendar dates in America/New_York', () => {
  const start = parseDateArg('2026-09-07', { bound: 'start' });
  const end = parseDateArg('2026-09-07', { bound: 'end' });
  assert.equal(start, zonedLocalToUtcMs(2026, 9, 7, 0, 0, 0));
  assert.equal(displayRecordedAt(start), displayRecordedAt(zonedLocalToUtcMs(2026, 9, 7, 0, 0, 0)));
  assert.ok(end > start);
  assert.ok(end < parseDateArg('2026-09-08', { bound: 'start' }));
  const noon = parseDateArg('2026-09-07T12:00');
  assert.equal(noon, zonedLocalToUtcMs(2026, 9, 7, 12, 0, 0));
});

test('periodKey buckets by New York calendar', () => {
  const monday = zonedLocalToUtcMs(2026, 9, 7, 9, 0, 0);
  const sunday = zonedLocalToUtcMs(2026, 9, 6, 23, 0, 0);
  assert.equal(periodKey(monday, 'day'), '2026-09-07');
  assert.equal(periodKey(monday, 'month'), '2026-09');
  assert.equal(periodKey(monday, 'week'), '2026-09-07');
  assert.equal(periodKey(sunday, 'week'), '2026-08-31');
});

test('migrate + add + tags + fts', () => {
  const db = migrate(dbPath);
  const writer = new JournalWriter(db);
  const entry = writer.addEntry({
    mood: 7,
    note: 'walked after work and felt lighter',
    energy: 6,
    tags: ['walk', 'work'],
    recordedAt: Date.UTC(2026, 8, 1, 16, 0, 0),
  });
  assert.equal(entry.mood, 7);
  assert.deepEqual(entry.tags, ['walk', 'work']);
  assert.equal(entry.recorded_at, Date.UTC(2026, 8, 1, 16, 0, 0));
  const again = writer.addEntry({
    mood: 4,
    note: 'heavy rain and a headache',
    tags: ['weather'],
  });
  assert.ok(again.recorded_at <= Date.now());
  assert.ok(again.recorded_at >= Date.now() - 5_000);
  const fts = db.prepare('SELECT COUNT(*) AS n FROM entries_fts WHERE entries_fts MATCH ?').get(
    escapeFtsQuery('felt lighter'),
  );
  assert.equal(fts.n, 1);
  db.close();
});

test('update is a patch and cannot change recorded_at via payload leftovers', () => {
  const db = migrate(join(dir, 'update.sqlite'));
  const writer = new JournalWriter(db);
  const created = writer.addEntry({ mood: 5, note: 'original', tags: ['a'] });
  const recorded = created.recorded_at;
  const updated = writer.updateEntry(created.id, {
    note: 'edited',
    recorded_at: 1,
    recordedAt: 1,
  });
  assert.equal(updated.note, 'edited');
  assert.equal(updated.mood, 5);
  assert.equal(updated.recorded_at, recorded);
  assert.deepEqual(updated.tags, ['a']);
  db.close();
});

test('soft delete hides the row from getEntry', () => {
  const db = migrate(join(dir, 'delete.sqlite'));
  const writer = new JournalWriter(db);
  const created = writer.addEntry({ mood: 8, note: 'gone soon' });
  writer.deleteEntry(created.id);
  assert.equal(writer.getEntry(created.id), null);
  const raw = db.prepare('SELECT deleted_at FROM entries WHERE id = ?').get(created.id);
  assert.ok(raw.deleted_at);
  db.close();
});

test('fts phrase escaping strips operators', () => {
  const escaped = escapeFtsQuery('hello AND "world" OR NOT foo*');
  assert.equal(escaped, '"hello world foo"');
  assert.throws(() => escapeFtsQuery('a'));
});

test('formatEntry omits raw unix timestamps', () => {
  const formatted = formatEntry(
    {
      id: '11111111-1111-1111-1111-111111111111',
      recorded_at: Date.UTC(2026, 8, 7, 17, 10, 32),
      created_at: 1,
      updated_at: 2,
      deleted_at: null,
      mood: 6,
      note: 'ok',
      energy: null,
      anxiety: null,
      sleep_hours: null,
      sleep_quality: null,
      social: null,
      context: null,
    },
    ['walk'],
  );
  assert.equal(formatted.display_recorded_at, displayRecordedAt(Date.UTC(2026, 8, 7, 17, 10, 32)));
  assert.equal(formatted.recorded_at, undefined);
  assert.equal(formatted.created_at, undefined);
  assert.deepEqual(formatted.tags, ['walk']);
});

test('normalizeTags allows unicode letters and NFC-folds accents', () => {
  assert.deepEqual(normalizeTags(['aunt-nê']), ['aunt-nê']);
  assert.deepEqual(normalizeTags(['Aunt-NÊ']), ['aunt-nê']);
  assert.deepEqual(normalizeTags(['aunt-ne\u0302']), ['aunt-nê']);
  assert.throws(() => normalizeTags(['no spaces']), /invalid tag/);
});

test('logEvent strips notes', () => {
  const lines = [];
  const orig = console.log;
  console.log = (msg) => lines.push(msg);
  try {
    logEvent('test', 'write', { note: 'SECRET', id: 'e1', token: 't' });
  } finally {
    console.log = orig;
  }
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.note, undefined);
  assert.equal(parsed.token, undefined);
  assert.equal(parsed.id, 'e1');
});
