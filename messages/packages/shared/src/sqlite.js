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

/**
 * Triple software lock: URI mode=ro, constructor readOnly, PRAGMA query_only.
 * Kernel :ro bind-mount is the fourth lock (compose).
 */
export function openReadOnlyDb(dbPath) {
  let db;
  if (engine.kind === 'node') {
    const options = { readOnly: true, allowExtension: false };
    const uri = dbPath.startsWith('file:') ? dbPath : `file:${dbPath}?mode=ro`;
    try {
      db = new engine.Database(uri, options);
    } catch {
      db = new engine.Database(dbPath, options);
    }
  } else {
    db = new engine.Database(dbPath, { readonly: true, fileMustExist: true });
  }
  db = wrapDb(db);
  db.exec('PRAGMA query_only = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}
