package ingest

import (
	"strings"
	"time"

	"go.mau.fi/mautrix-gmessages/pkg/libgm/gmproto"

	"openclaw-messages/gmessages-worker/internal/store"
)

type ConversationMeta struct {
	Title     string
	Thread    string
	NativeID  string
}

func MetaFromConversation(conv *gmproto.Conversation) ConversationMeta {
	if conv == nil {
		return ConversationMeta{Thread: "unknown"}
	}
	meta := ConversationMeta{
		NativeID: conv.GetConversationID(),
		Title:    strings.TrimSpace(conv.GetName()),
		Thread:   threadType(conv),
	}
	if meta.Title == "" {
		meta.Title = firstOtherName(conv)
	}
	if meta.Title == "" {
		meta.Title = conv.GetConversationID()
	}
	return meta
}

func threadType(conv *gmproto.Conversation) string {
	if conv == nil {
		return "unknown"
	}
	if conv.GetIsGroupChat() {
		return "group"
	}
	others := conv.GetOtherParticipants()
	if len(others) > 1 {
		return "group"
	}
	visible := 0
	for _, p := range conv.GetParticipants() {
		if p != nil && !p.GetIsMe() {
			visible++
		}
	}
	if visible > 1 {
		return "group"
	}
	if conv.GetConversationID() != "" {
		return "dm"
	}
	return "unknown"
}

func firstOtherName(conv *gmproto.Conversation) string {
	for _, p := range conv.GetParticipants() {
		if p == nil || p.GetIsMe() {
			continue
		}
		if name := strings.TrimSpace(p.GetFullName()); name != "" {
			return name
		}
		if name := strings.TrimSpace(p.GetFirstName()); name != "" {
			return name
		}
		if num := participantNumber(p); num != "" {
			return num
		}
	}
	return ""
}

func participantNumber(p *gmproto.Participant) string {
	if p == nil {
		return ""
	}
	if n := strings.TrimSpace(p.GetFormattedNumber()); n != "" {
		return n
	}
	if id := p.GetID(); id != nil {
		return strings.TrimSpace(id.GetNumber())
	}
	return ""
}

func participantNativeID(p *gmproto.Participant) string {
	if p == nil {
		return ""
	}
	if id := p.GetID(); id != nil {
		if pid := strings.TrimSpace(id.GetParticipantID()); pid != "" {
			return pid
		}
		if n := strings.TrimSpace(id.GetNumber()); n != "" {
			return n
		}
	}
	if cid := strings.TrimSpace(p.GetContactID()); cid != "" {
		return cid
	}
	return participantNumber(p)
}

func Message(msg *gmproto.Message, meta ConversationMeta) (store.Message, bool) {
	if msg == nil || msg.GetMessageID() == "" || msg.GetConversationID() == "" {
		return store.Message{}, false
	}
	status := msg.GetMessageStatus().GetStatus()
	direction := directionOf(status)
	deleted := isDeleted(status)
	body, typ, hasMedia := contentOf(msg)
	senderID, senderName, senderHandle := senderOf(msg, direction, meta)

	out := store.Message{
		NativeID:             msg.GetMessageID(),
		ConversationNativeID: msg.GetConversationID(),
		SenderNativeID:       senderID,
		SenderDisplayName:    senderName,
		SenderHandle:         senderHandle,
		Direction:            direction,
		SentAt:               sentAtMs(msg.GetTimestamp()),
		MessageType:          typ,
		Body:                 body,
		ReplyToNativeID:      msg.GetReplyMessage().GetMessageID(),
		IsDeleted:            deleted,
		ConversationTitle:    meta.Title,
		ThreadType:           meta.Thread,
		Raw: map[string]any{
			"conversationId": msg.GetConversationID(),
			"fromMe":         direction == "outbound",
			"hasMedia":       hasMedia,
			"status":         status.String(),
		},
	}
	if out.ThreadType == "" {
		out.ThreadType = "unknown"
	}
	if out.ConversationTitle == "" {
		out.ConversationTitle = msg.GetConversationID()
	}
	return out, true
}

func directionOf(status gmproto.MessageStatusType) string {
	n := int32(status)
	switch {
	case n >= 200 && n < 300:
		return "system"
	case n >= 1 && n < 100:
		return "outbound"
	default:
		return "inbound"
	}
}

func isDeleted(status gmproto.MessageStatusType) bool {
	return status == gmproto.MessageStatusType_MESSAGE_DELETED
}

func contentOf(msg *gmproto.Message) (*string, string, bool) {
	var texts []string
	hasMedia := false
	mediaType := "other"
	for _, info := range msg.GetMessageInfo() {
		if info == nil {
			continue
		}
		if mc := info.GetMessageContent(); mc != nil {
			if t := strings.TrimSpace(mc.GetContent()); t != "" {
				texts = append(texts, t)
			}
		}
		if media := info.GetMediaContent(); media != nil {
			hasMedia = true
			mediaType = mediaKind(media)
			if name := strings.TrimSpace(media.GetMediaName()); name != "" && len(texts) == 0 {
				texts = append(texts, name)
			}
		}
	}
	if len(texts) == 0 {
		if sub := strings.TrimSpace(msg.GetSubject()); sub != "" {
			texts = append(texts, sub)
		}
	}
	if len(texts) == 0 && len(msg.GetReactions()) > 0 {
		if uni := firstReaction(msg); uni != "" {
			return strPtr(uni), "reaction", false
		}
	}
	var body *string
	if len(texts) > 0 {
		joined := strings.Join(texts, "\n")
		body = &joined
	}
	typ := "other"
	switch {
	case hasMedia:
		typ = mediaType
	case body != nil:
		typ = "text"
	}
	return body, typ, hasMedia
}

func mediaKind(media *gmproto.MediaContent) string {
	if media == nil {
		return "other"
	}
	mime := strings.ToLower(media.GetMimeType())
	if strings.Contains(mime, "sticker") {
		return "sticker"
	}
	switch media.GetFormat() {
	case gmproto.MediaFormats_IMAGE_JPEG, gmproto.MediaFormats_IMAGE_JPG,
		gmproto.MediaFormats_IMAGE_PNG, gmproto.MediaFormats_IMAGE_GIF,
		gmproto.MediaFormats_IMAGE_WBMP, gmproto.MediaFormats_IMAGE_X_MS_BMP,
		gmproto.MediaFormats_IMAGE_UNSPECIFIED:
		return "image"
	case gmproto.MediaFormats_VIDEO_MP4, gmproto.MediaFormats_VIDEO_3G2,
		gmproto.MediaFormats_VIDEO_3GPP, gmproto.MediaFormats_VIDEO_WEBM,
		gmproto.MediaFormats_VIDEO_MKV, gmproto.MediaFormats_VIDEO_UNSPECIFIED:
		return "video"
	case gmproto.MediaFormats_AUDIO_AAC, gmproto.MediaFormats_AUDIO_AMR,
		gmproto.MediaFormats_AUDIO_MP3, gmproto.MediaFormats_AUDIO_MPEG,
		gmproto.MediaFormats_AUDIO_MPG, gmproto.MediaFormats_AUDIO_MP4,
		gmproto.MediaFormats_AUDIO_MP4_LATM, gmproto.MediaFormats_AUDIO_3GPP,
		gmproto.MediaFormats_AUDIO_OGG, gmproto.MediaFormats_AUDIO_UNSPECIFIED:
		return "audio"
	case gmproto.MediaFormats_APP_PDF, gmproto.MediaFormats_APP_TXT,
		gmproto.MediaFormats_APP_HTML, gmproto.MediaFormats_APP_DOC,
		gmproto.MediaFormats_APP_DOCX, gmproto.MediaFormats_APP_PPTX,
		gmproto.MediaFormats_APP_PPT, gmproto.MediaFormats_APP_XLSX,
		gmproto.MediaFormats_APP_XLS, gmproto.MediaFormats_APP_APK,
		gmproto.MediaFormats_APP_ZIP, gmproto.MediaFormats_APP_JAR,
		gmproto.MediaFormats_APP_UNSPECIFIED, gmproto.MediaFormats_TEXT_VCARD:
		return "document"
	default:
		if strings.HasPrefix(mime, "image/") {
			return "image"
		}
		if strings.HasPrefix(mime, "video/") {
			return "video"
		}
		if strings.HasPrefix(mime, "audio/") {
			return "audio"
		}
		return "other"
	}
}

func firstReaction(msg *gmproto.Message) string {
	for _, r := range msg.GetReactions() {
		if r == nil || r.GetData() == nil {
			continue
		}
		if u := strings.TrimSpace(r.GetData().GetUnicode()); u != "" {
			return u
		}
	}
	return ""
}

func senderOf(msg *gmproto.Message, direction string, meta ConversationMeta) (id, name, handle string) {
	if direction == "outbound" {
		return "me", "me", ""
	}
	if p := msg.GetSenderParticipant(); p != nil {
		id = participantNativeID(p)
		name = strings.TrimSpace(p.GetFullName())
		if name == "" {
			name = strings.TrimSpace(p.GetFirstName())
		}
		handle = participantNumber(p)
		if id == "" {
			id = handle
		}
		if name == "" {
			name = handle
		}
		if id != "" {
			return id, name, handle
		}
	}
	if pid := strings.TrimSpace(msg.GetParticipantID()); pid != "" {
		return pid, meta.Title, ""
	}
	if meta.NativeID != "" {
		return meta.NativeID, meta.Title, ""
	}
	return msg.GetConversationID(), meta.Title, ""
}

func sentAtMs(ts int64) int64 {
	if ts <= 0 {
		return time.Now().UnixMilli()
	}
	switch {
	case ts > 1e16:
		return ts / 1e6
	case ts > 1e14:
		return ts / 1e3
	case ts > 1e11:
		return ts
	default:
		return ts * 1000
	}
}

func strPtr(s string) *string {
	return &s
}
