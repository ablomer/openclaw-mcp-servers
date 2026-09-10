package session

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

var requiredCookies = []string{"SID", "HSID", "SSID", "OSID", "APISID", "SAPISID"}

var (
	cookieFlagRe = regexp.MustCompile(`(?i)(?:^|[\s\\])(?:-b|--cookie)\s+(?:'([^']+)'|"([^"]+)"|(\S+))`)
	headerCookieRe = regexp.MustCompile(`(?i)(?:^|[\s\\])(?:-H|--header)\s+['"]Cookie:\s*([^'"]+)['"]`)
)

func ParseCookies(raw string) (map[string]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("empty cookie payload")
	}
	var cookies map[string]string
	var err error
	if strings.HasPrefix(raw, "{") {
		cookies, err = parseJSONCookies(raw)
	} else {
		cookies, err = parseCurlCookies(raw)
	}
	if err != nil {
		return nil, err
	}
	if err := requireCookies(cookies); err != nil {
		return nil, err
	}
	return cookies, nil
}

func parseJSONCookies(raw string) (map[string]string, error) {
	var obj map[string]any
	if err := json.Unmarshal([]byte(raw), &obj); err != nil {
		return nil, fmt.Errorf("cookie json: %w", err)
	}
	out := make(map[string]string, len(obj))
	for k, v := range obj {
		switch t := v.(type) {
		case string:
			if t != "" {
				out[k] = t
			}
		default:
			return nil, fmt.Errorf("cookie %s is not a string", k)
		}
	}
	return out, nil
}

func parseCurlCookies(raw string) (map[string]string, error) {
	if pair := extractCookieHeader(raw); pair != "" {
		return splitCookiePairs(pair), nil
	}
	if looksLikeCookiePairs(raw) {
		return splitCookiePairs(raw), nil
	}
	return nil, fmt.Errorf("no Cookie header or cookie pairs found")
}

func extractCookieHeader(raw string) string {
	if m := cookieFlagRe.FindStringSubmatch(raw); len(m) == 4 {
		for _, g := range m[1:] {
			if g != "" {
				return strings.TrimSpace(g)
			}
		}
	}
	if m := headerCookieRe.FindStringSubmatch(raw); len(m) == 2 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

func looksLikeCookiePairs(raw string) bool {
	return strings.Contains(raw, "=") && (strings.Contains(raw, ";") || strings.Contains(raw, "SID="))
}

func splitCookiePairs(raw string) map[string]string {
	out := map[string]string{}
	for _, part := range strings.Split(raw, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		name, value, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		out[name] = strings.TrimSpace(value)
	}
	return out
}

func requireCookies(cookies map[string]string) error {
	var missing []string
	for _, name := range requiredCookies {
		if strings.TrimSpace(cookies[name]) == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required cookies: %s", strings.Join(missing, ", "))
	}
	return nil
}
