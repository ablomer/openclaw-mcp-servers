import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWritableDb } from './sqlite.js';

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
const SCHEMA_VERSION = 1;

export function migrate(dbPath) {
  const db = openWritableDb(dbPath);
  try {
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    const current = row?.v ?? 0;
    if (current < SCHEMA_VERSION) {
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        SCHEMA_VERSION,
        Date.now(),
      );
    }
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}
