package log

import (
	"encoding/json"
	"os"
	"strings"
	"time"
)

var forbidden = map[string]struct{}{
	"body":          {},
	"text":          {},
	"raw_json":      {},
	"rawjson":       {},
	"cookie":        {},
	"cookies":       {},
	"token":         {},
	"password":      {},
	"authorization": {},
	"caption":       {},
}

func Event(scope, event string, extra map[string]any) {
	out := map[string]any{
		"ts":    time.Now().UnixMilli(),
		"scope": scope,
		"event": event,
	}
	for k, v := range extra {
		if _, skip := forbidden[strings.ToLower(k)]; skip {
			continue
		}
		out[k] = v
	}
	enc := json.NewEncoder(os.Stdout)
	_ = enc.Encode(out)
}
