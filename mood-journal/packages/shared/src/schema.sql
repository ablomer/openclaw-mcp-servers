CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  recorded_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  mood INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 10),
  note TEXT NOT NULL CHECK (length(note) > 0),
  energy INTEGER CHECK (energy IS NULL OR energy BETWEEN 1 AND 10),
  anxiety INTEGER CHECK (anxiety IS NULL OR anxiety BETWEEN 1 AND 10),
  sleep_hours REAL CHECK (sleep_hours IS NULL OR (sleep_hours >= 0 AND sleep_hours <= 24)),
  sleep_quality INTEGER CHECK (sleep_quality IS NULL OR sleep_quality BETWEEN 1 AND 10),
  social TEXT CHECK (social IS NULL OR social IN ('alone', 'one_on_one', 'group')),
  context TEXT CHECK (context IS NULL OR context IN ('home', 'work', 'travel', 'outdoors', 'other'))
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (entry_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_entries_recorded ON entries(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_alive_recorded ON entries(deleted_at, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_mood ON entries(mood);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  note,
  content = 'entries',
  content_rowid = 'rowid',
  tokenize = 'unicode61'
);

CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, note) VALUES (new.rowid, new.note);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, note) VALUES('delete', old.rowid, old.note);
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, note) VALUES('delete', old.rowid, old.note);
  INSERT INTO entries_fts(rowid, note) VALUES (new.rowid, new.note);
END;
