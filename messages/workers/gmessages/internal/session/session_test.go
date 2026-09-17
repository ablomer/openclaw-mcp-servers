package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mau.fi/mautrix-gmessages/pkg/libgm"
	"go.mau.fi/mautrix-gmessages/pkg/libgm/gmproto"
)

func sampleCookies() map[string]string {
	return map[string]string{
		"SID":    "sid-value",
		"HSID":   "hsid-value",
		"SSID":   "ssid-value",
		"OSID":   "osid-value",
		"APISID": "apisid-value",
		"SAPISID": "sapisid-value",
	}
}

func sampleAuth() *libgm.AuthData {
	auth := libgm.NewAuthData()
	auth.SessionID = uuid.MustParse("11111111-1111-1111-1111-111111111111")
	auth.TachyonAuthToken = []byte("tachyon-token")
	auth.TachyonExpiry = time.Date(2026, 9, 11, 3, 22, 0, 0, time.UTC)
	auth.SetCookies(sampleCookies())
	auth.Browser = &gmproto.Device{SourceID: "browser-1", UserID: 42}
	auth.Mobile = &gmproto.Device{SourceID: "mobile-1"}
	return auth
}

func TestUsable(t *testing.T) {
	if Usable(nil) {
		t.Fatal("nil should not be usable")
	}
	auth := libgm.NewAuthData()
	if Usable(auth) {
		t.Fatal("empty auth should not be usable")
	}
	auth = sampleAuth()
	if !Usable(auth) {
		t.Fatal("sample auth should be usable")
	}
	auth.TachyonAuthToken = nil
	if Usable(auth) {
		t.Fatal("missing tachyon should not be usable")
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	orig := sampleAuth()
	if err := Save(dir, orig); err != nil {
		t.Fatal(err)
	}
	got, fromBak, err := LoadInfo(dir)
	if err != nil {
		t.Fatal(err)
	}
	if fromBak {
		t.Fatal("loaded primary session as backup")
	}
	if !Usable(got) {
		t.Fatal("loaded session not usable")
	}
	if got.SessionID != orig.SessionID {
		t.Fatalf("session id %s", got.SessionID)
	}
	if string(got.TachyonAuthToken) != "tachyon-token" {
		t.Fatalf("token=%q", got.TachyonAuthToken)
	}
	if got.RefreshKey == nil || len(got.RefreshKey.D) == 0 {
		t.Fatal("refresh key missing")
	}
	if got.Browser.GetSourceID() != "browser-1" || got.Mobile.GetSourceID() != "mobile-1" {
		raw, _ := json.Marshal(got.Browser)
		t.Fatalf("devices: browser=%s mobile=%s", raw, got.Mobile.GetSourceID())
	}
	if got.Cookies["SID"] != "sid-value" {
		t.Fatalf("cookies=%v", got.Cookies)
	}
}

func TestLoadRestoresBackup(t *testing.T) {
	dir := t.TempDir()
	orig := sampleAuth()
	raw, err := json.Marshal(orig)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, SessionBakFile), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	got, fromBak, err := LoadInfo(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !fromBak {
		t.Fatal("expected backup restore")
	}
	if !Usable(got) {
		t.Fatal("restored session not usable")
	}
	if _, err := os.Stat(filepath.Join(dir, SessionFile)); err != nil {
		t.Fatalf("session.json not rewritten: %v", err)
	}
}

func TestApplyCookiesFile(t *testing.T) {
	dir := t.TempDir()
	auth := sampleAuth()
	auth.SetCookies(map[string]string{"SID": "old"})
	payload := `{
		"SID": "sid-value",
		"HSID": "hsid-value",
		"SSID": "ssid-value",
		"OSID": "osid-value",
		"APISID": "apisid-value",
		"SAPISID": "sapisid-value"
	}`
	if err := os.WriteFile(filepath.Join(dir, CookiesJSONFile), []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	applied, err := ApplyCookiesFile(dir, auth)
	if err != nil {
		t.Fatal(err)
	}
	if !applied {
		t.Fatal("expected cookies to apply")
	}
	if auth.Cookies["SID"] != "sid-value" {
		t.Fatalf("cookies=%v", auth.Cookies)
	}
	if _, err := os.Stat(filepath.Join(dir, CookiesJSONFile)); !os.IsNotExist(err) {
		t.Fatal("cookie file should be removed")
	}
	got, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.Cookies["SAPISID"] != "sapisid-value" {
		t.Fatalf("persisted cookies=%v", got.Cookies)
	}
}

func TestInvalidateKeepsBackupLoadable(t *testing.T) {
	dir := t.TempDir()
	if err := Save(dir, sampleAuth()); err != nil {
		t.Fatal(err)
	}
	if err := Invalidate(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, SessionFile)); !os.IsNotExist(err) {
		t.Fatal("session.json should be gone after invalidate")
	}
	got, fromBak, err := LoadInfo(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !fromBak || !Usable(got) {
		t.Fatalf("fromBak=%v usable=%v", fromBak, Usable(got))
	}
}

func TestClearRemovesBackup(t *testing.T) {
	dir := t.TempDir()
	if err := Save(dir, sampleAuth()); err != nil {
		t.Fatal(err)
	}
	if err := Invalidate(dir); err != nil {
		t.Fatal(err)
	}
	if err := Clear(dir); err != nil {
		t.Fatal(err)
	}
	got, fromBak, err := LoadInfo(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got != nil || fromBak {
		t.Fatalf("cleared session still loaded: auth=%v fromBak=%v", got != nil, fromBak)
	}
}
