package session

import (
	"strings"
	"testing"
)

func sampleJSON() string {
	return `{
		"SID": "sid-value",
		"HSID": "hsid-value",
		"SSID": "ssid-value",
		"OSID": "osid-value",
		"APISID": "apisid-value",
		"SAPISID": "sapisid-value",
		"__Secure-1PSIDTS": "psidts-value"
	}`
}

func TestParseCookiesJSON(t *testing.T) {
	got, err := ParseCookies(sampleJSON())
	if err != nil {
		t.Fatal(err)
	}
	if got["SID"] != "sid-value" || got["__Secure-1PSIDTS"] != "psidts-value" {
		t.Fatalf("unexpected cookies: %#v", got)
	}
}

func TestParseCookiesCurlDashBAfterHeaders(t *testing.T) {
	raw := "curl --url 'https://messages.google.com/web/config?pli=1' \\\n" +
		"  -H 'accept: text/html,application/xhtml+xml' \\\n" +
		"  -H 'cache-control: max-age=0' \\\n" +
		"  -b 'HSID=hsid-value; SSID=ssid-value; APISID=apisid-value; SAPISID=sapisid-value; SID=sid-value; OSID=osid-value; __Secure-1PSIDTS=psidts-value' \\\n" +
		"  -H 'user-agent: Mozilla/5.0'"
	got, err := ParseCookies(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got["SID"] != "sid-value" || got["HSID"] != "hsid-value" || got["OSID"] != "osid-value" {
		t.Fatalf("unexpected cookies: %#v", got)
	}
}

func TestParseCookiesCurlHeader(t *testing.T) {
	raw := `curl 'https://messages.google.com/web/config' -H 'Cookie: SID=sid-value; HSID=hsid-value; SSID=ssid-value; OSID=osid-value; APISID=apisid-value; SAPISID=sapisid-value'`
	got, err := ParseCookies(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got["OSID"] != "osid-value" {
		t.Fatalf("missing OSID: %#v", got)
	}
}

func TestParseCookiesRejectsIncomplete(t *testing.T) {
	_, err := ParseCookies(`{"SID":"only"}`)
	if err == nil || !strings.Contains(err.Error(), "missing required cookies") {
		t.Fatalf("expected missing cookies error, got %v", err)
	}
}
