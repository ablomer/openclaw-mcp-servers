package main

import (
	"context"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"openclaw-messages/gmessages-worker/internal/log"
	"openclaw-messages/gmessages-worker/internal/worker"
)

func main() {
	syscall.Umask(0o027)

	cfg := worker.Config{
		DBPath:          envOr("MESSAGES_DB_PATH", "/data/messages.sqlite"),
		SessionsDir:     envOr("SESSIONS_DIR", "/sessions"),
		BackfillChats:   envInt("GMESSAGES_BACKFILL_CHATS", 200),
		BackfillPerChat: envInt("GMESSAGES_BACKFILL_PER_CHAT", 200),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := worker.Run(ctx, cfg); err != nil && !isSignal(err) {
		log.Event("gmessages", "fatal", map[string]any{"name": err.Error()})
		os.Exit(1)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func isSignal(err error) bool {
	return err == context.Canceled || err == context.DeadlineExceeded
}
