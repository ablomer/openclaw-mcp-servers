package session

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"go.mau.fi/mautrix-gmessages/pkg/libgm"

	"openclaw-messages/gmessages-worker/internal/log"
)

const (
	SessionFile     = "session.json"
	CookiesJSONFile = "cookies.json"
	CookiesCurlFile = "cookies.curl"
)

func Dir(sessionsRoot string) string {
	return filepath.Join(sessionsRoot, "gmessages")
}

func Load(dir string) (*libgm.AuthData, error) {
	path := filepath.Join(dir, SessionFile)
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	auth := &libgm.AuthData{}
	if err := json.Unmarshal(raw, auth); err != nil {
		return nil, err
	}
	return auth, nil
}

func Save(dir string, auth *libgm.AuthData) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(auth)
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, SessionFile+".tmp")
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, SessionFile))
}

func CookieFiles(dir string) []string {
	return []string{
		filepath.Join(dir, CookiesJSONFile),
		filepath.Join(dir, CookiesCurlFile),
	}
}

func ReadCookiesFile(dir string) (map[string]string, string, error) {
	for _, path := range CookieFiles(dir) {
		raw, err := os.ReadFile(path)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, path, err
		}
		cookies, err := ParseCookies(string(raw))
		if err != nil {
			return nil, path, err
		}
		return cookies, path, nil
	}
	return nil, "", os.ErrNotExist
}

func Invalidate(dir string) error {
	path := filepath.Join(dir, SessionFile)
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	return os.Rename(path, path+".bak")
}

func RemoveCookieFiles(dir string) {
	for _, path := range CookieFiles(dir) {
		_ = os.Remove(path)
	}
}

func WaitForCookies(ctx context.Context, dir string) (map[string]string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	var lastInvalid string
	for {
		cookies, _, err := ReadCookiesFile(dir)
		if err == nil {
			return cookies, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			msg := err.Error()
			if msg != lastInvalid {
				lastInvalid = msg
				log.Event("gmessages", "cookies_invalid", map[string]any{"name": msg})
			}
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}
