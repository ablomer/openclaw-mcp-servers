#!/usr/bin/env node
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function openWritable(path) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(path, { allowExtension: false });
  } catch {
    const Database = require('better-sqlite3');
    return new Database(path);
  }
}

const DB_PATH = process.env.MESSAGES_DB_PATH || '/data/messages.sqlite';
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const KEEP = Number(process.env.BACKUP_KEEP || 14);
const INTERVAL_MS = Number(process.env.BACKUP_INTERVAL_MS || 24 * 60 * 60 * 1000);

function prune() {
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('messages-') && f.endsWith('.sqlite'))
    .sort();
  while (files.length > KEEP) {
    const victim = files.shift();
    unlinkSync(join(BACKUP_DIR, victim));
  }
}

function backupOnce() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(BACKUP_DIR, `messages-${stamp}.sqlite`);
  const db = openWritable(DB_PATH);
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  prune();
  console.log(JSON.stringify({ ts: Date.now(), scope: 'backup', event: 'ok', dest: dest.split('/').pop() }));
}

const once = process.argv.includes('--once');
backupOnce();
if (once) process.exit(0);
setInterval(() => {
  try {
    backupOnce();
  } catch (err) {
    console.error(JSON.stringify({ ts: Date.now(), scope: 'backup', event: 'failed', name: err?.name }));
  }
}, INTERVAL_MS);
