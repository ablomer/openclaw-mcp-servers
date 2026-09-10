package store

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	_ "modernc.org/sqlite"
)

const (
	Source     = "gmessages"
	schemaVer  = 1
	previewLen = 180
)

//go:embed schema.sql
var schemaSQL string

type Writer struct {
	db *sql.DB
	mu sync.Mutex
}

func Open(dbPath string) (*Writer, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o750); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA busy_timeout = 5000;
		PRAGMA synchronous = NORMAL;
		PRAGMA foreign_keys = ON;
	`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := db.Exec(schemaSQL); err != nil {
		_ = db.Close()
		return nil, err
	}
	var current sql.NullInt64
	if err := db.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&current); err != nil {
		_ = db.Close()
		return nil, err
	}
	if !current.Valid || current.Int64 < schemaVer {
		if _, err := db.Exec(
			`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
			schemaVer, time.Now().UnixMilli(),
		); err != nil {
			_ = db.Close()
			return nil, err
		}
	}
	return &Writer{db: db}, nil
}

func (w *Writer) Close() error {
	return w.db.Close()
}

func entityID(nativeID string) string {
	return Source + ":" + nativeID
}

func preview(body *string) *string {
	if body == nil {
		return nil
	}
	text := strings.Join(strings.Fields(*body), " ")
	if text == "" {
		return nil
	}
	if utf8.RuneCountInString(text) <= previewLen {
		return &text
	}
	runes := []rune(text)
	cut := string(runes[:previewLen]) + "…"
	return &cut
}

type Message struct {
	NativeID             string
	ConversationNativeID string
	SenderNativeID       string
	SenderDisplayName    string
	SenderHandle         string
	Direction            string
	SentAt               int64
	MessageType          string
	Body                 *string
	ReplyToNativeID      string
	IsDeleted            bool
	ConversationTitle    string
	ThreadType           string
	Raw                  map[string]any
}

func (w *Writer) UpsertConversation(nativeID, title, threadType string, participantCount *int) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.upsertConversationLocked(nativeID, title, threadType, participantCount)
}

func (w *Writer) upsertConversationLocked(nativeID, title, threadType string, participantCount *int) (string, error) {
	if nativeID == "" {
		return "", fmt.Errorf("conversation nativeId required")
	}
	if threadType == "" {
		threadType = "unknown"
	}
	id := entityID(nativeID)
	now := time.Now().UnixMilli()
	_, err := w.db.Exec(`
		INSERT INTO conversations (
			id, source, native_id, title, thread_type, last_message_at, last_preview,
			participant_count, metadata_json, updated_at
		) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?)
		ON CONFLICT(source, native_id) DO UPDATE SET
			title = COALESCE(excluded.title, conversations.title),
			thread_type = excluded.thread_type,
			participant_count = COALESCE(excluded.participant_count, conversations.participant_count),
			updated_at = excluded.updated_at
	`, id, Source, nativeID, nullString(title), threadType, nullInt(participantCount), now)
	return id, err
}

func (w *Writer) UpsertMessage(m Message) (string, error) {
	if m.NativeID == "" || m.ConversationNativeID == "" {
		return "", fmt.Errorf("nativeId and conversationNativeId required")
	}
	if m.ThreadType == "" {
		m.ThreadType = "unknown"
	}
	if m.MessageType == "" {
		m.MessageType = "text"
	}
	if m.Direction == "" {
		return "", fmt.Errorf("direction required")
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	conversationID, err := w.upsertConversationLocked(m.ConversationNativeID, m.ConversationTitle, m.ThreadType, nil)
	if err != nil {
		return "", err
	}

	var senderID any
	if m.SenderNativeID != "" {
		sid := entityID(m.SenderNativeID)
		now := time.Now().UnixMilli()
		if _, err := w.db.Exec(`
			INSERT INTO contacts (id, source, native_id, display_name, handle, metadata_json, updated_at)
			VALUES (?, ?, ?, ?, ?, NULL, ?)
			ON CONFLICT(source, native_id) DO UPDATE SET
				display_name = COALESCE(excluded.display_name, contacts.display_name),
				handle = COALESCE(excluded.handle, contacts.handle),
				updated_at = excluded.updated_at
		`, sid, Source, m.SenderNativeID, nullString(m.SenderDisplayName), nullString(m.SenderHandle), now); err != nil {
			return "", err
		}
		if _, err := w.db.Exec(
			`INSERT OR IGNORE INTO conversation_participants (conversation_id, contact_id) VALUES (?, ?)`,
			conversationID, sid,
		); err != nil {
			return "", err
		}
		senderID = sid
	}

	id := entityID(m.NativeID)
	ingested := time.Now().UnixMilli()
	var reply any
	if m.ReplyToNativeID != "" {
		reply = entityID(m.ReplyToNativeID)
	}
	var raw any
	if m.Raw != nil {
		b, err := json.Marshal(m.Raw)
		if err != nil {
			return "", err
		}
		raw = string(b)
	}
	deleted := 0
	if m.IsDeleted {
		deleted = 1
	}
	if _, err := w.db.Exec(`
		INSERT INTO messages (
			id, conversation_id, source, native_id, sender_contact_id, direction,
			sent_at, ingested_at, message_type, body, reply_to_id, is_deleted, raw_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(source, native_id) DO UPDATE SET
			body = excluded.body,
			is_deleted = excluded.is_deleted,
			message_type = excluded.message_type,
			raw_json = excluded.raw_json,
			sender_contact_id = COALESCE(excluded.sender_contact_id, messages.sender_contact_id)
	`, id, conversationID, Source, m.NativeID, senderID, m.Direction, m.SentAt, ingested, m.MessageType, nullBody(m.Body), reply, deleted, raw); err != nil {
		return "", err
	}
	if _, err := w.db.Exec(`
		UPDATE conversations
		SET last_message_at = ?, last_preview = ?, updated_at = ?
		WHERE id = ? AND last_message_at <= ?
	`, m.SentAt, preview(m.Body), ingested, conversationID, m.SentAt); err != nil {
		return "", err
	}
	return id, nil
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullBody(body *string) any {
	if body == nil || *body == "" {
		return nil
	}
	return *body
}

func (w *Writer) MessageCount() (int, error) {
	var n int
	err := w.db.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&n)
	return n, err
}

func (w *Writer) FTSCount(match string) (int, error) {
	var n int
	err := w.db.QueryRow(`SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH ?`, match).Scan(&n)
	return n, err
}

func (w *Writer) ConversationPreview(nativeID string) (string, error) {
	var preview sql.NullString
	err := w.db.QueryRow(`SELECT last_preview FROM conversations WHERE native_id = ?`, nativeID).Scan(&preview)
	if err != nil {
		return "", err
	}
	return preview.String, nil
}

func nullInt(n *int) any {
	if n == nil {
		return nil
	}
	return *n
}
