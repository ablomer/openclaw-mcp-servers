package ingest

import (
	"testing"

	"go.mau.fi/mautrix-gmessages/pkg/libgm/gmproto"
)

func TestTextInbound(t *testing.T) {
	msg := &gmproto.Message{
		MessageID:      "m1",
		ConversationID: "c1",
		Timestamp:      1_700_000_000_000,
		MessageStatus:  &gmproto.MessageStatus{Status: gmproto.MessageStatusType_INCOMING_COMPLETE},
		MessageInfo: []*gmproto.MessageInfo{{
			Data: &gmproto.MessageInfo_MessageContent{
				MessageContent: &gmproto.MessageContent{Content: "hello there"},
			},
		}},
		SenderParticipant: &gmproto.Participant{
			ID:       &gmproto.SmallInfo{ParticipantID: "p1", Number: "+15551212"},
			FullName: "Maya",
		},
	}
	rec, ok := Message(msg, ConversationMeta{NativeID: "c1", Title: "Maya", Thread: "dm"})
	if !ok {
		t.Fatal("expected record")
	}
	if rec.Direction != "inbound" || rec.MessageType != "text" {
		t.Fatalf("got type=%s dir=%s", rec.MessageType, rec.Direction)
	}
	if rec.Body == nil || *rec.Body != "hello there" {
		t.Fatalf("body=%v", rec.Body)
	}
	if rec.SenderNativeID != "p1" || rec.SenderDisplayName != "Maya" {
		t.Fatalf("sender=%s name=%s", rec.SenderNativeID, rec.SenderDisplayName)
	}
	if rec.SentAt != 1_700_000_000_000 {
		t.Fatalf("sentAt=%d", rec.SentAt)
	}
	if rec.ThreadType != "dm" {
		t.Fatalf("thread=%s", rec.ThreadType)
	}
}

func TestMediaCaptionAndOutbound(t *testing.T) {
	msg := &gmproto.Message{
		MessageID:      "m2",
		ConversationID: "c1",
		Timestamp:      1_700_000_001,
		MessageStatus:  &gmproto.MessageStatus{Status: gmproto.MessageStatusType_OUTGOING_COMPLETE},
		MessageInfo: []*gmproto.MessageInfo{{
			Data: &gmproto.MessageInfo_MediaContent{
				MediaContent: &gmproto.MediaContent{
					Format:    gmproto.MediaFormats_IMAGE_JPEG,
					MediaName: "sunset.jpg",
				},
			},
		}},
	}
	rec, ok := Message(msg, ConversationMeta{NativeID: "c1", Title: "Maya", Thread: "dm"})
	if !ok {
		t.Fatal("expected record")
	}
	if rec.Direction != "outbound" || rec.SenderNativeID != "me" {
		t.Fatalf("dir=%s sender=%s", rec.Direction, rec.SenderNativeID)
	}
	if rec.MessageType != "image" || rec.Body == nil || *rec.Body != "sunset.jpg" {
		t.Fatalf("type=%s body=%v", rec.MessageType, rec.Body)
	}
	if rec.Raw["hasMedia"] != true {
		t.Fatalf("raw=%v", rec.Raw)
	}
}

func TestReaction(t *testing.T) {
	msg := &gmproto.Message{
		MessageID:      "m3",
		ConversationID: "c1",
		MessageStatus:  &gmproto.MessageStatus{Status: gmproto.MessageStatusType_INCOMING_COMPLETE},
		Reactions: []*gmproto.ReactionEntry{{
			Data: &gmproto.ReactionData{Unicode: "👍"},
		}},
	}
	rec, ok := Message(msg, ConversationMeta{NativeID: "c1", Title: "Maya", Thread: "dm"})
	if !ok {
		t.Fatal("expected record")
	}
	if rec.MessageType != "reaction" || rec.Body == nil || *rec.Body != "👍" {
		t.Fatalf("type=%s body=%v", rec.MessageType, rec.Body)
	}
}

func TestGroupVsDM(t *testing.T) {
	group := MetaFromConversation(&gmproto.Conversation{
		ConversationID: "g1",
		Name:           "Family",
		IsGroupChat:    true,
	})
	if group.Thread != "group" || group.Title != "Family" {
		t.Fatalf("group meta=%+v", group)
	}
	dm := MetaFromConversation(&gmproto.Conversation{
		ConversationID: "d1",
		Participants: []*gmproto.Participant{
			{IsMe: true, FullName: "Me"},
			{FullName: "Maya", ID: &gmproto.SmallInfo{Number: "+1"}},
		},
	})
	if dm.Thread != "dm" || dm.Title != "Maya" {
		t.Fatalf("dm meta=%+v", dm)
	}
}

func TestReplyAndMicroseconds(t *testing.T) {
	msg := &gmproto.Message{
		MessageID:      "m4",
		ConversationID: "c1",
		Timestamp:      1_700_000_000_000_000,
		ReplyMessage:   &gmproto.ReplyMessage{MessageID: "m0"},
		MessageInfo: []*gmproto.MessageInfo{{
			Data: &gmproto.MessageInfo_MessageContent{
				MessageContent: &gmproto.MessageContent{Content: "reply"},
			},
		}},
	}
	rec, ok := Message(msg, ConversationMeta{NativeID: "c1", Thread: "dm"})
	if !ok {
		t.Fatal("expected record")
	}
	if rec.ReplyToNativeID != "m0" {
		t.Fatalf("reply=%s", rec.ReplyToNativeID)
	}
	if rec.SentAt != 1_700_000_000_000 {
		t.Fatalf("sentAt=%d", rec.SentAt)
	}
}
