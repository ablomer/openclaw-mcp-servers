package store

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrateUpsertFTS(t *testing.T) {
	dir := t.TempDir()
	w, err := Open(filepath.Join(dir, "messages.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	body1 := "hello secret project alpha"
	if _, err := w.UpsertMessage(Message{
		NativeID:             "m1",
		ConversationNativeID: "chat1",
		SenderNativeID:       "alice",
		SenderDisplayName:    "Alice",
		Direction:            "inbound",
		SentAt:               1_700_000_000_000,
		Body:                 &body1,
		ConversationTitle:    "Alice",
		ThreadType:           "dm",
	}); err != nil {
		t.Fatal(err)
	}
	body2 := "hello secret project alpha (edited)"
	if _, err := w.UpsertMessage(Message{
		NativeID:             "m1",
		ConversationNativeID: "chat1",
		SenderNativeID:       "alice",
		Direction:            "inbound",
		SentAt:               1_700_000_000_000,
		Body:                 &body2,
		ConversationTitle:    "Alice",
		ThreadType:           "dm",
	}); err != nil {
		t.Fatal(err)
	}

	n, err := w.MessageCount()
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("count=%d", n)
	}
	fts, err := w.FTSCount("secret")
	if err != nil {
		t.Fatal(err)
	}
	if fts != 1 {
		t.Fatalf("fts=%d", fts)
	}
	preview, err := w.ConversationPreview("chat1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(preview, "edited") {
		t.Fatalf("preview=%q", preview)
	}
}
