#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importDaylioCsv, migrate } from '../packages/shared/src/index.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((arg) => arg !== '--dry-run');
const csvPath = positional[0];
const dbPath = positional[1] || join(process.cwd(), 'data/mood-journal/db/mood-journal.sqlite');

if (!csvPath) {
  console.error('usage: node scripts/import-daylio.mjs <csv-path> [db-path] [--dry-run]');
  process.exit(1);
}

const csv = readFileSync(csvPath, 'utf8');
const db = migrate(dbPath);
try {
  const summary = importDaylioCsv(db, csv, { dryRun });
  console.log(JSON.stringify({ event: dryRun ? 'daylio_import_dry_run' : 'daylio_import', dbPath, ...summary }));
  if (summary.failed > 0) process.exit(1);
} finally {
  db.close();
}
