import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JournalWriter, migrate, parseDateArg, zonedLocalToUtcMs } from '@openclaw-mood-journal/shared';
import { createTools } from '../src/tools.js';

const dir = mkdtempSync(join(tmpdir(), 'mood-journal-mcp-'));
const dbPath = join(dir, 'mood-journal.sqlite');
const db = migrate(dbPath);
const writer = new JournalWriter(db);

const walkMorning = writer.addEntry({
  mood: 8,
  note: 'morning walk in the park felt great',
  energy: 8,
  anxiety: 2,
  sleep_hours: 7.5,
  sleep_quality: 8,
  social: 'alone',
  context: 'outdoors',
  tags: ['walk', 'exercise'],
  recordedAt: zonedLocalToUtcMs(2026, 9, 1, 8, 0, 0),
});
const workAfternoon = writer.addEntry({
  mood: 4,
  note: 'long meeting drained me',
  energy: 3,
  anxiety: 7,
  social: 'group',
  context: 'work',
  tags: ['work', 'meeting'],
  recordedAt: zonedLocalToUtcMs(2026, 9, 2, 15, 30, 0),
});
writer.addEntry({
  mood: 6,
  note: 'quiet evening after the meeting',
  energy: 5,
  tags: ['work'],
  recordedAt: zonedLocalToUtcMs(2026, 9, 2, 21, 0, 0),
});

const tools = createTools(db);

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function parse(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

function assertNoRawTimestamps(payload) {
  const json = JSON.stringify(payload);
  assert.equal(/"recorded_at"/.test(json), false);
  assert.equal(/"created_at"/.test(json), false);
  assert.equal(/"updated_at"/.test(json), false);
  assert.equal(/"deleted_at"/.test(json), false);
}

test('add_entry sets server time and ignores client timestamps', () => {
  const before = Date.now();
  const payload = parse(
    tools.addEntry({
      mood: 7,
      note: 'just now',
      recorded_at: 1,
      created_at: 1,
      updated_at: 99,
    }),
  );
  const after = Date.now();
  assertNoRawTimestamps(payload);
  assert.match(payload.entry.display_recorded_at, / AM | PM /);
  const recordedMs = parseDateArg(payload.entry.display_recorded_at);
  assert.ok(recordedMs >= before - 1000);
  assert.ok(recordedMs <= after + 1000);
  const raw = db.prepare('SELECT recorded_at FROM entries WHERE id = ?').get(payload.entry.id);
  assert.notEqual(raw.recorded_at, 1);
});

test('get_entry returns tags and display_recorded_at', () => {
  const payload = parse(tools.getEntry({ id: walkMorning.id }));
  assert.equal(payload.entry.mood, 8);
  assert.deepEqual(payload.entry.tags, ['exercise', 'walk']);
  assert.equal(payload.entry.note, 'morning walk in the park felt great');
  assertNoRawTimestamps(payload);
  const missing = tools.getEntry({ id: '00000000-0000-0000-0000-000000000000' });
  assert.equal(missing.isError, true);
});

test('list_entries filters by date, mood, and tags', () => {
  const week = parse(tools.listEntries({ from: '2026-09-01', to: '2026-09-02', limit: 10 }));
  assert.equal(week.entries.length, 3);
  assertNoRawTimestamps(week);
  const low = parse(tools.listEntries({ from: '2026-09-01', to: '2026-09-02', mood_max: 5 }));
  assert.equal(low.entries.length, 1);
  assert.equal(low.entries[0].mood, 4);
  const tagged = parse(tools.listEntries({ from: '2026-09-01', to: '2026-09-02', tags: ['walk'] }));
  assert.equal(tagged.entries.length, 1);
  assert.equal(tagged.entries[0].id, walkMorning.id);
});

test('update_entry patches note and leaves recorded_at alone', () => {
  const before = db.prepare('SELECT recorded_at FROM entries WHERE id = ?').get(workAfternoon.id);
  const payload = parse(
    tools.updateEntry({
      id: workAfternoon.id,
      note: 'long meeting drained me (edited)',
      recorded_at: 1,
    }),
  );
  assert.equal(payload.entry.note, 'long meeting drained me (edited)');
  const after = db.prepare('SELECT recorded_at FROM entries WHERE id = ?').get(workAfternoon.id);
  assert.equal(after.recorded_at, before.recorded_at);
});

test('delete_entry is a soft delete', () => {
  const created = parse(tools.addEntry({ mood: 5, note: 'temporary' }));
  const deleted = parse(tools.deleteEntry({ id: created.entry.id }));
  assert.equal(deleted.deleted, true);
  const missing = tools.getEntry({ id: created.entry.id });
  assert.equal(missing.isError, true);
  const listed = parse(tools.listEntries({ limit: 50 }));
  assert.equal(listed.entries.some((e) => e.id === created.entry.id), false);
});

test('search_entries uses phrase match and omits full notes', () => {
  const payload = parse(tools.searchEntries({ query: 'park' }));
  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].id, walkMorning.id);
  assert.equal(payload.results[0].note, undefined);
  assert.ok(payload.results[0].snippet);
  assertNoRawTimestamps(payload);
  const injected = tools.searchEntries({ query: 'walk AND DROP TABLE entries' });
  const inj = parse(injected);
  assert.ok(Array.isArray(inj.results));
});

test('summarize_range and mood_by_period aggregate the fixture', () => {
  const summary = parse(tools.summarizeRange({ from: '2026-09-01', to: '2026-09-02' }));
  assert.equal(summary.n, 3);
  assert.equal(summary.mood.min, 4);
  assert.equal(summary.mood.max, 8);
  assert.equal(summary.mood.avg, 6);
  assert.ok(summary.top_tags.some((t) => t.name === 'work' && t.n === 2));
  assertNoRawTimestamps(summary);

  const byDay = parse(tools.moodByPeriod({ period: 'day', from: '2026-09-01', to: '2026-09-02' }));
  assert.equal(byDay.buckets.length, 2);
  assert.equal(byDay.buckets[0].period_start, '2026-09-01');
  assert.equal(byDay.buckets[0].avg_mood, 8);
  assert.equal(byDay.buckets[1].n, 2);
  assert.equal(byDay.buckets[1].avg_mood, 5);
});

test('compare_tagged splits average mood', () => {
  const payload = parse(tools.compareTagged({ tag: 'exercise', from: '2026-09-01', to: '2026-09-02' }));
  assert.equal(payload.with_tag.n, 1);
  assert.equal(payload.with_tag.avg_mood, 8);
  assert.equal(payload.without_tag.n, 2);
  assert.equal(payload.without_tag.avg_mood, 5);
});

test('list_tags returns usage counts', () => {
  const payload = parse(tools.listTags());
  const work = payload.tags.find((t) => t.name === 'work');
  assert.ok(work.n >= 2);
});

test('validation rejects bad mood and empty note', () => {
  const mood = tools.addEntry({ mood: 11, note: 'nope' });
  assert.equal(mood.isError, true);
  const note = tools.addEntry({ mood: 5, note: '   ' });
  assert.equal(note.isError, true);
  const tag = tools.addEntry({ mood: 5, note: 'ok', tags: ['NO SPACES'] });
  assert.equal(tag.isError, true);
});

test('add_entry accepts unicode tags', () => {
  const payload = parse(tools.addEntry({ mood: 7, note: 'visited family', tags: ['aunt-nê'] }));
  assert.deepEqual(payload.entry.tags, ['aunt-nê']);
});
