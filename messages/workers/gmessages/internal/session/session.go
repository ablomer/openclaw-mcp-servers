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
	SessionBakFile  = "session.json.bak"
	CookiesJSONFile = "cookies.json"
	CookiesCurlFile = "cookies.curl"
)

func Dir(sessionsRoot string) string {
	return filepath.Join(sessionsRoot, "gmessages")
}

func Usable(auth *libgm.AuthData) bool {
	if auth == nil || auth.Browser == nil || len(auth.TachyonAuthToken) == 0 {
		return false
	}
	if auth.RefreshKey == nil || len(auth.RefreshKey.D) == 0 {
		return false
	}
	return true
}

func Load(dir string) (*libgm.AuthData, error) {
	auth, _, err := LoadInfo(dir)
	return auth, err
}

func LoadInfo(dir string) (*libgm.AuthData, bool, error) {
	auth, err := loadFile(filepath.Join(dir, SessionFile))
	if err != nil {
		return nil, false, err
	}
	if auth != nil {
		return auth, false, nil
	}
	bak, err := loadFile(filepath.Join(dir, SessionBakFile))
	if err != nil {
		return nil, false, err
	}
	if bak == nil {
		return nil, false, nil
	}
	if err := Save(dir, bak); err != nil {
		return bak, true, nil
	}
	return bak, true, nil
}

func loadFile(path string) (*libgm.AuthData, error) {
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

func ApplyCookiesFile(dir string, auth *libgm.AuthData) (bool, error) {
	if auth == nil {
		return false, nil
	}
	cookies, _, err := ReadCookiesFile(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	auth.SetCookies(cookies)
	if err := Save(dir, auth); err != nil {
		return false, err
	}
	RemoveCookieFiles(dir)
	return true, nil
}

func Invalidate(dir string) error {
	path := filepath.Join(dir, SessionFile)
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	return os.Rename(path, filepath.Join(dir, SessionBakFile))
}

func Clear(dir string) error {
	err1 := os.Remove(filepath.Join(dir, SessionFile))
	err2 := os.Remove(filepath.Join(dir, SessionBakFile))
	if err1 != nil && !errors.Is(err1, os.ErrNotExist) {
		return err1
	}
	if err2 != nil && !errors.Is(err2, os.ErrNotExist) {
		return err2
	}
	return nil
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

func WaitRetry(ctx context.Context, dir string, delay time.Duration) error {
	if delay <= 0 {
		delay = 2 * time.Second
	}
	deadline := time.Now().Add(delay)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		if _, _, err := ReadCookiesFile(dir); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if !time.Now().Before(deadline) {
				return nil
			}
		}
	}
}
