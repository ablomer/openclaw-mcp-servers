import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);

function loadEngine() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    return { kind: 'node', Database: DatabaseSync };
  } catch {
    const Database = require('better-sqlite3');
    return { kind: 'better', Database };
  }
}

const engine = loadEngine();

function wrapDb(db) {
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = origPrepare(sql);
    if (typeof stmt.setAllowBareNamedParameters === 'function') {
      stmt.setAllowBareNamedParameters(true);
    }
    return stmt;
  };
  return db;
}

export function configureWriterPragmas(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
}

export function openWritableDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = wrapDb(
    engine.kind === 'node'
      ? new engine.Database(dbPath, { allowExtension: false })
      : new engine.Database(dbPath),
  );
  configureWriterPragmas(db);
  return db;
}

export function withTransaction(db, fn) {
  if (typeof db.transaction === 'function') {
    return db.transaction(fn)();
  }
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  }
}
