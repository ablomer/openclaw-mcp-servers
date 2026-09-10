CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('whatsapp','gmessages','instagram')),
  native_id TEXT NOT NULL,
  title TEXT,
  thread_type TEXT NOT NULL CHECK (thread_type IN ('dm','group','unknown')),
  last_message_at INTEGER NOT NULL DEFAULT 0,
  last_preview TEXT,
  participant_count INTEGER,
  metadata_json TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (source, native_id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('whatsapp','gmessages','instagram')),
  native_id TEXT NOT NULL,
  display_name TEXT,
  handle TEXT,
  metadata_json TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (source, native_id)
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  PRIMARY KEY (conversation_id, contact_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  source TEXT NOT NULL CHECK (source IN ('whatsapp','gmessages','instagram')),
  native_id TEXT NOT NULL,
  sender_contact_id TEXT REFERENCES contacts(id),
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound','system')),
  sent_at INTEGER NOT NULL,
  ingested_at INTEGER NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN (
    'text','image','video','audio','document','sticker','reaction','other'
  )),
  body TEXT,
  reply_to_id TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  UNIQUE (source, native_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_last ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_sent ON messages(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_source_sent ON messages(source, sent_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body,
  content = 'messages',
  content_rowid = 'rowid',
  tokenize = 'unicode61'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
