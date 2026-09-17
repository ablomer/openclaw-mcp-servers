package worker

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"go.mau.fi/mautrix-gmessages/pkg/libgm"
	"go.mau.fi/mautrix-gmessages/pkg/libgm/events"
	"go.mau.fi/mautrix-gmessages/pkg/libgm/gmproto"

	"openclaw-messages/gmessages-worker/internal/ingest"
	"openclaw-messages/gmessages-worker/internal/log"
	"openclaw-messages/gmessages-worker/internal/session"
	"openclaw-messages/gmessages-worker/internal/store"
)

const scope = "gmessages"

const (
	minRetry     = 2 * time.Second
	maxRetry     = 30 * time.Second
	persistEvery = 15 * time.Minute
)

type Config struct {
	DBPath          string
	SessionsDir     string
	BackfillChats   int
	BackfillPerChat int
}

func Run(ctx context.Context, cfg Config) error {
	if cfg.BackfillChats <= 0 {
		cfg.BackfillChats = 200
	}
	if cfg.BackfillPerChat <= 0 {
		cfg.BackfillPerChat = 200
	}
	writer, err := store.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer writer.Close()

	sessDir := session.Dir(cfg.SessionsDir)
	log.Event(scope, "started", map[string]any{"authDir": "gmessages"})
	retry := minRetry

	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		auth, fromBak, err := session.LoadInfo(sessDir)
		if err != nil {
			log.Event(scope, "session_load_failed", map[string]any{"name": errName(err)})
			return err
		}
		if fromBak && session.Usable(auth) {
			log.Event(scope, "session_restored", map[string]any{"hint": "reloaded session.json.bak after a previous invalidate"})
		}
		if !session.Usable(auth) {
			if err := pair(ctx, cfg, writer, sessDir); err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					return err
				}
				log.Event(scope, "pair_failed", map[string]any{"name": errName(err)})
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(3 * time.Second):
				}
				continue
			}
			retry = minRetry
			continue
		}
		if err := connectAndServe(ctx, cfg, writer, sessDir, auth); err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return err
			}
			log.Event(scope, "disconnected", map[string]any{"name": errName(err)})
			if isAuthError(err) {
				log.Event(scope, "needs_cookies", map[string]any{
					"hint": "drop cookies.json to refresh Google login; existing pairing is kept",
				})
			}
			if err := session.WaitRetry(ctx, sessDir, retry); err != nil {
				return err
			}
			if retry < maxRetry {
				retry *= 2
				if retry > maxRetry {
					retry = maxRetry
				}
			}
			continue
		}
		retry = minRetry
	}
}

func pair(ctx context.Context, cfg Config, writer *store.Writer, sessDir string) error {
	log.Event(scope, "needs_pair", map[string]any{"hint": "drop cookies.json or cookies.curl into sessions/gmessages"})
	cookies, err := session.WaitForCookies(ctx, sessDir)
	if err != nil {
		return err
	}
	auth := libgm.NewAuthData()
	auth.SessionID = uuid.New()
	auth.SetCookies(cookies)
	rt := newRuntime(cfg, writer, sessDir, auth)
	cli := rt.client
	defer cli.Disconnect()
	if err := cli.FetchConfig(ctx); err != nil {
		log.Event(scope, "config_failed", map[string]any{"name": errName(err)})
	}
	emoji, ps, err := cli.StartGaiaPairing(ctx)
	if err != nil {
		return err
	}
	log.Event(scope, "needs_pair", map[string]any{"emoji": emoji, "hint": "confirm this emoji on the phone"})
	if _, err := cli.FinishGaiaPairing(ctx, ps); err != nil {
		return err
	}
	cli.Disconnect()
	if err := session.Save(sessDir, auth); err != nil {
		return err
	}
	session.RemoveCookieFiles(sessDir)
	log.Event(scope, "paired", nil)
	return nil
}

func connectAndServe(ctx context.Context, cfg Config, writer *store.Writer, sessDir string, auth *libgm.AuthData) error {
	applied, err := session.ApplyCookiesFile(sessDir, auth)
	if err != nil {
		log.Event(scope, "cookies_invalid", map[string]any{"name": errName(err)})
	} else if applied {
		log.Event(scope, "cookies_merged", map[string]any{"hint": "refreshed Google cookies on existing pairing"})
	}
	rt := newRuntime(cfg, writer, sessDir, auth)
	if err := rt.client.Connect(); err != nil {
		return err
	}
	rt.persist()
	log.Event(scope, "connected", nil)
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
			rt.backfill(ctx)
		}
	}()
	return rt.wait(ctx)
}

type runtime struct {
	cfg     Config
	writer  *store.Writer
	sessDir string
	auth    *libgm.AuthData
	client  *libgm.Client

	cacheMu sync.Mutex
	cache   map[string]ingest.ConversationMeta

	backfillMu sync.Mutex
	logout     chan struct{}
	logoutOnce sync.Once
}

func newRuntime(cfg Config, writer *store.Writer, sessDir string, auth *libgm.AuthData) *runtime {
	if auth.SessionID == uuid.Nil {
		auth.SessionID = uuid.New()
	}
	rt := &runtime{
		cfg:     cfg,
		writer:  writer,
		sessDir: sessDir,
		auth:    auth,
		cache:   map[string]ingest.ConversationMeta{},
		logout:  make(chan struct{}),
	}
	rt.client = libgm.NewClient(auth, nil, zerolog.Nop())
	rt.client.SetEventHandler(rt.onEvent)
	return rt
}

func (rt *runtime) wait(ctx context.Context) error {
	ticker := time.NewTicker(persistEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			rt.persist()
			rt.client.Disconnect()
			return ctx.Err()
		case <-rt.logout:
			rt.persist()
			rt.client.Disconnect()
			return nil
		case <-ticker.C:
			rt.persist()
		}
	}
}

func (rt *runtime) signalLogout() {
	rt.logoutOnce.Do(func() { close(rt.logout) })
}

func (rt *runtime) persist() {
	if err := session.Save(rt.sessDir, rt.auth); err != nil {
		log.Event(scope, "session_save_failed", map[string]any{"name": errName(err)})
	}
}

func (rt *runtime) meta(conversationID string) ingest.ConversationMeta {
	rt.cacheMu.Lock()
	defer rt.cacheMu.Unlock()
	if m, ok := rt.cache[conversationID]; ok {
		return m
	}
	return ingest.ConversationMeta{NativeID: conversationID, Title: conversationID, Thread: "unknown"}
}

func (rt *runtime) remember(meta ingest.ConversationMeta) {
	if meta.NativeID == "" {
		return
	}
	rt.cacheMu.Lock()
	rt.cache[meta.NativeID] = meta
	rt.cacheMu.Unlock()
}

func (rt *runtime) onEvent(raw any) {
	switch evt := raw.(type) {
	case *libgm.WrappedMessage:
		rt.ingestMessage(evt.Message, !evt.IsOld)
	case *gmproto.Message:
		rt.ingestMessage(evt, true)
	case *gmproto.Conversation:
		meta := ingest.MetaFromConversation(evt)
		rt.remember(meta)
		n := len(evt.GetParticipants())
		if _, err := rt.writer.UpsertConversation(meta.NativeID, meta.Title, meta.Thread, &n); err != nil {
			log.Event(scope, "conv_upsert_failed", map[string]any{"name": errName(err)})
		}
	case *events.ClientReady:
		log.Event(scope, "connected", nil)
		for _, conv := range evt.Conversations {
			meta := ingest.MetaFromConversation(conv)
			rt.remember(meta)
		}
		go rt.backfill(context.Background())
	case *gmproto.UserAlertEvent:
		switch evt.GetAlertType() {
		case gmproto.AlertType_BROWSER_ACTIVE:
			go rt.backfill(context.Background())
		case gmproto.AlertType_BROWSER_INACTIVE,
			gmproto.AlertType_BROWSER_INACTIVE_FROM_TIMEOUT,
			gmproto.AlertType_BROWSER_INACTIVE_FROM_INACTIVITY:
			log.Event(scope, "browser_inactive", map[string]any{"alert": evt.GetAlertType().String()})
			if err := rt.client.SetActiveSession(); err != nil {
				log.Event(scope, "set_active_failed", map[string]any{"name": errName(err)})
			}
		case gmproto.AlertType_MOBILE_DATABASE_SYNC_COMPLETE:
			go rt.backfill(context.Background())
		}
	case *events.PairSuccessful:
		rt.persist()
	case *events.AuthTokenRefreshed:
		rt.persist()
	case *events.GaiaLoggedOut:
		_ = session.Clear(rt.sessDir)
		log.Event(scope, "needs_pair", map[string]any{"hint": "logged out; drop new cookies"})
		rt.signalLogout()
	case *events.ListenFatalError:
		log.Event(scope, "disconnected", map[string]any{"name": errName(evt.Error), "loggedOut": false})
		rt.signalLogout()
	case *events.PhoneNotResponding:
		log.Event(scope, "phone_not_responding", nil)
	case *events.PhoneRespondingAgain:
		log.Event(scope, "phone_responding", nil)
		go rt.backfill(context.Background())
	}
}

func (rt *runtime) ingestMessage(msg *gmproto.Message, live bool) {
	if msg == nil {
		return
	}
	rec, ok := ingest.Message(msg, rt.meta(msg.GetConversationID()))
	if !ok {
		return
	}
	if _, err := rt.writer.UpsertMessage(rec); err != nil {
		log.Event(scope, "upsert_failed", map[string]any{"name": errName(err)})
		return
	}
	if live {
		log.Event(scope, "upsert", map[string]any{"count": 1})
	}
}

func (rt *runtime) backfill(ctx context.Context) {
	if !rt.backfillMu.TryLock() {
		return
	}
	defer rt.backfillMu.Unlock()
	if ctx.Err() != nil {
		return
	}
	resp, err := rt.client.ListConversations(rt.cfg.BackfillChats, gmproto.ListConversationsRequest_INBOX)
	if err != nil {
		log.Event(scope, "backfill_failed", map[string]any{"name": errName(err)})
		return
	}
	convs := conversationsOf(resp)
	total := 0
	for i, conv := range convs {
		if i >= rt.cfg.BackfillChats {
			break
		}
		if ctx.Err() != nil {
			return
		}
		meta := ingest.MetaFromConversation(conv)
		rt.remember(meta)
		n := len(conv.GetParticipants())
		_, _ = rt.writer.UpsertConversation(meta.NativeID, meta.Title, meta.Thread, &n)
		total += rt.backfillThread(ctx, meta)
	}
	log.Event(scope, "history_set", map[string]any{"count": total, "conversations": len(convs)})
}

func (rt *runtime) backfillThread(ctx context.Context, meta ingest.ConversationMeta) int {
	if meta.NativeID == "" {
		return 0
	}
	var cursor *gmproto.Cursor
	remaining := rt.cfg.BackfillPerChat
	n := 0
	for remaining > 0 {
		if ctx.Err() != nil {
			return n
		}
		page := int64(remaining)
		if page > 50 {
			page = 50
		}
		resp, err := rt.client.FetchMessages(meta.NativeID, page, cursor)
		if err != nil {
			log.Event(scope, "backfill_thread_failed", map[string]any{"name": errName(err)})
			return n
		}
		msgs := messagesOf(resp)
		if len(msgs) == 0 {
			return n
		}
		for _, msg := range msgs {
			rec, ok := ingest.Message(msg, meta)
			if !ok {
				continue
			}
			if _, err := rt.writer.UpsertMessage(rec); err == nil {
				n++
			}
		}
		remaining -= len(msgs)
		next := cursorOf(resp)
		if next == nil || next == cursor {
			return n
		}
		cursor = next
	}
	return n
}

func conversationsOf(resp *gmproto.ListConversationsResponse) []*gmproto.Conversation {
	if resp == nil {
		return nil
	}
	if convs := resp.GetConversations(); len(convs) > 0 {
		return convs
	}
	return nil
}

func messagesOf(resp *gmproto.ListMessagesResponse) []*gmproto.Message {
	if resp == nil {
		return nil
	}
	if msgs := resp.GetMessages(); len(msgs) > 0 {
		return msgs
	}
	return nil
}

func cursorOf(resp *gmproto.ListMessagesResponse) *gmproto.Cursor {
	if resp == nil {
		return nil
	}
	return resp.GetCursor()
}

func isAuthError(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, events.ErrInvalidCredentials) ||
		errors.Is(err, events.ErrRequestedEntityNotFound)
}

func errName(err error) string {
	if err == nil {
		return ""
	}
	t := err.Error()
	if len(t) > 200 {
		return t[:200]
	}
	return t
}
