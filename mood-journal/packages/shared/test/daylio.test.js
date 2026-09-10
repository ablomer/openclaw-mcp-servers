import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/migrate.js';
import {
  daylioRowToEntry,
  htmlToMarkdown,
  importDaylioCsv,
  mapMood,
  parseDaylioDateTime,
} from '../src/daylio.js';
import { zonedLocalToUtcMs } from '../src/time.js';

const dir = mkdtempSync(join(tmpdir(), 'mood-journal-daylio-'));
const samplePath = join(dirname(fileURLToPath(import.meta.url)), '../../../daylio_export_sample.csv');

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('mapMood uses odd 1-10 values', () => {
  assert.equal(mapMood('good'), 7);
  assert.equal(mapMood('RAD'), 9);
  assert.equal(mapMood('awful'), 1);
  assert.equal(mapMood('bad'), 3);
  assert.equal(mapMood('meh'), 5);
  assert.throws(() => mapMood('great'), /unknown mood/);
});

test('parseDaylioDateTime interprets America/New_York', () => {
  assert.equal(parseDaylioDateTime('6/25/2026', '10:00 PM'), zonedLocalToUtcMs(2026, 6, 25, 22, 0, 0));
  assert.equal(parseDaylioDateTime('6/24/2026', '1:34 AM'), zonedLocalToUtcMs(2026, 6, 24, 1, 34, 0));
});

test('htmlToMarkdown converts lists, breaks, and bold', () => {
  const md = htmlToMarkdown(
    '<ul><li>Drove Jenna to dermatologist, picked her up at 8:15 am</li><li>Nap</li></ul>',
  );
  assert.equal(md, '- Drove Jenna to dermatologist, picked her up at 8:15 am\n- Nap');
  assert.equal(htmlToMarkdown('Checking in.<br><br>Moods been good.'), 'Checking in.\n\nMoods been good.');
  assert.match(
    htmlToMarkdown('leaning <b>heavily</b> on the negative side'),
    /\*\*heavily\*\*/,
  );
  assert.equal(htmlToMarkdown('<ol><li>First</li><li>Second</li></ol>'), '1. First\n2. Second');
  assert.equal(htmlToMarkdown('plain <i>italic</i>'), 'plain *italic*');
});

test('daylioRowToEntry puts activities in the note and uses no tags', () => {
  const entry = daylioRowToEntry({
    full_date: '5/24/2026',
    time: '10:01 PM',
    mood: 'meh',
    activities:
      'tired | unsure | anxious | stressed | hopeless | programming | movies & tv | wellbutrin (450mg) | caplyta (42mg) | lamictal (200mg) | arousal | writing | oversleeping',
    scales: 'Positivity 😁:\u00a01/10\u00a0points',
    note: "Oversleeping like crazy, feels like I'm consciously choosing to stay in bed<br><br>Worked on Tonewheel mostly<br>Tavern at the end of the day<br><br>Started bingeing Suits on the side<br><br>Feeling a weird mix. My mood seems stable, maybe even a little elevated, but my thoughts are leaning <b>heavily</b> on the negative side, and my anxiety is high.",
  });
  assert.equal(entry.mood, 5);
  assert.deepEqual(entry.tags, []);
  assert.match(entry.note, /\*\*heavily\*\*/);
  assert.match(entry.note, /^[\s\S]*\n\nActivities: tired, unsure, anxious, stressed, hopeless, programming, movies & tv, wellbutrin \(450mg\), caplyta \(42mg\), lamictal \(200mg\), arousal, writing, oversleeping\nPositivity: 1\/10$/);
});

test('empty note with activities is just the activities line', () => {
  const entry = daylioRowToEntry({
    full_date: '6/1/2026',
    time: '10:48 PM',
    mood: 'good',
    activities: 'tutti | sabi | piano',
    scales: '',
    note: '',
  });
  assert.equal(entry.note, 'Activities: tutti, sabi, piano');
  assert.deepEqual(entry.tags, []);
});

test('importDaylioCsv loads the sample and is idempotent', () => {
  const csv = readFileSync(samplePath, 'utf8');
  const dbPath = join(dir, 'sample.sqlite');
  const db = migrate(dbPath);
  const first = importDaylioCsv(db, csv);
  assert.equal(first.imported, 10);
  assert.equal(first.skipped, 0);
  assert.equal(first.failed, 0);

  const rows = db.prepare('SELECT mood, note FROM entries WHERE deleted_at IS NULL ORDER BY recorded_at DESC').all();
  assert.equal(rows.length, 10);
  for (const row of rows) {
    assert.ok([1, 3, 5, 7, 9].includes(row.mood));
  }
  const tagged = db.prepare('SELECT COUNT(*) AS n FROM entry_tags').get();
  assert.equal(tagged.n, 0);

  const list = rows.find((row) => row.note.startsWith('- Drove Jenna'));
  assert.ok(list);
  assert.match(list.note, /Activities: tired, stressed, potato/);
  assert.match(list.note, /Positivity: 3\/10/);

  const bold = rows.find((row) => row.note.includes('**heavily**'));
  assert.ok(bold);
  assert.equal(bold.mood, 5);

  const second = importDaylioCsv(db, csv);
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 10);
  assert.equal(second.failed, 0);
  const count = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE deleted_at IS NULL').get();
  assert.equal(count.n, 10);
  db.close();
});
