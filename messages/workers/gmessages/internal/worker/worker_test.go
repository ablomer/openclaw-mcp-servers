package worker

import (
	"testing"

	"go.mau.fi/mautrix-gmessages/pkg/libgm/events"
)

func TestIsAuthError(t *testing.T) {
	if isAuthError(nil) {
		t.Fatal("nil")
	}
	if !isAuthError(events.ErrInvalidCredentials) {
		t.Fatal("invalid credentials")
	}
	if !isAuthError(events.ErrRequestedEntityNotFound) {
		t.Fatal("entity not found")
	}
}
