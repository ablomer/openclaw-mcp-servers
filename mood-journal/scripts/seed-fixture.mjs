#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JournalWriter, migrate, zonedLocalToUtcMs } from '../packages/shared/src/index.js';

const dbPath = process.argv[2] || join(process.cwd(), 'data/mood-journal/db/mood-journal.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = migrate(dbPath);
const writer = new JournalWriter(db);

writer.addEntry({
  mood: 8,
  note: 'fixture: morning walk felt great',
  energy: 8,
  tags: ['walk', 'exercise'],
  recordedAt: zonedLocalToUtcMs(2026, 9, 1, 8, 0, 0),
});
writer.addEntry({
  mood: 4,
  note: 'fixture: long meeting drained me',
  energy: 3,
  anxiety: 7,
  context: 'work',
  tags: ['work'],
  recordedAt: zonedLocalToUtcMs(2026, 9, 2, 15, 30, 0),
});

db.close();
console.log(JSON.stringify({ event: 'seeded', dbPath }));
