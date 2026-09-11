# OpenClaw MCP Server Guide

This repo exposes **five** MCP servers over Streamable HTTP. OpenClaw reaches them on the internal Docker networks; they are not published on the host and have no Traefik routes.

| Server | MCP name | Container | URL | Mode |
| --- | --- | --- | --- | --- |
| Gmail | `email` | `email-mcp` | `http://email-mcp:3000/mcp` | Read-only search/read. Cannot send mail. |
| Calendar | `calendar` | `calendar-mcp` | `http://calendar-mcp:3000/mcp` | Read plus create/update/delete events. Cannot create or delete calendars. |
| Messages | `messages` | `messages-mcp` | `http://messages-mcp:3000/mcp` | Read-only archive of WhatsApp, Google Messages, and Instagram. Cannot send. |
| Mood journal | `mood-journal` | `mood-journal-mcp` | `http://mood-journal-mcp:3000/mcp` | Read/write personal journal. Server owns timestamps. |
| Google Health | `google-health` | `google-health-mcp` | `http://google-health-mcp:3000/mcp` | Read-only sleep, exercise, and daily activity. Cannot write health data. |

Transport in OpenClaw config is `streamable-http`. Each process also serves `GET /healthz` on the same port.

---

## Shared conventions

### HTTP

Every server listens on `0.0.0.0:3000` (override with `PORT` / `HOST`).

| Path | Methods | Purpose |
| --- | --- | --- |
| `/mcp` | all | MCP Streamable HTTP. Stateless (new server instance per request). JSON body limit 1 MiB. |
| `/healthz` | `GET` | Liveness. See each server for the JSON body. |

DNS-rebinding protection is on. Allowed `Host` values are the container name, `container:3000`, `127.0.0.1`, `localhost`, and those hosts with `:3000`.

### Tool results

Successful calls return MCP `content` with one `text` item whose body is **JSON**. Errors set `isError: true` and put a short message in that same text field.

If the JSON payload exceeds **32 KiB**, the server replaces it with:

```json
{
  "truncated": true,
  "reason": "payload exceeded 32KiB cap",
  "bytes": 40000
}
```

Email and calendar wrap the `gog` CLI (`--json`). A `gog` timeout (30s) or output over 100 KiB becomes an error result. Google Health calls `health.googleapis.com` with a 30s timeout; sleep/exercise lists stop at 50 sessions.

### How to call a tool

From OpenClaw, use the configured MCP server name and the tool name below. Arguments are JSON objects matching the schemas in this guide.

---

## 1. Email (`email`)

Read-only Gmail via `gog`. Every invocation includes `--readonly` and `--gmail-no-send`. `get_message` and `get_thread` also pass `--sanitize-content` as a command flag (not a global `gog` flag). Allowed `gog` commands: `gmail.search`, `gmail.get`, `gmail.thread.get`, `gmail.labels.list`.

- **Health:** `{ "ok": true, "gog": true }` when `/usr/local/bin/gog` exists.
- **Auth:** shared gog-data volume (`GOG_DATA_DIR=/data`). Optional `GOG_ACCOUNT` selects the account.
- **Bodies:** sanitized by `gog`. Message/thread ids come from search or Gmail itself.

### `search_messages`

Search Gmail with [Gmail query syntax](https://support.google.com/mail/answer/7190).

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `query` | string | yes | 1–2000 characters | — |
| `max` | integer | no | 1–50 | `10` |

**Examples**

```json
{ "query": "from:ada@example.com newer_than:7d", "max": 20 }
```

```json
{ "query": "label:inbox subject:invoice has:attachment" }
```

Useful operators: `from:`, `to:`, `subject:`, `label:`, `in:inbox`, `is:unread`, `has:attachment`, `newer_than:7d`, `older_than:1m`, `after:2026/09/01`, quoted phrases.

**Returns:** JSON from `gog gmail search` (message list / ids). Use those ids with `get_message` / `get_thread`.

### `get_message`

Read one message. Body is sanitized. Never sends mail.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `id` | string | yes | 1–256 characters | — |
| `format` | `"full"` \| `"metadata"` | no | — | `full` |

```json
{ "id": "18c9a1…", "format": "metadata" }
```

**Returns:** JSON from `gog gmail get`. `metadata` skips the full body.

### `get_thread`

Read one thread. Body is sanitized.

| Argument | Type | Required | Constraints |
| --- | --- | --- | --- |
| `id` | string | yes | 1–256 characters |

```json
{ "id": "18c9a1…" }
```

**Returns:** JSON from `gog gmail thread get`.

### `list_labels`

List Gmail labels. No arguments.

```json
{}
```

**Returns:** JSON from `gog gmail labels list`.

### Not available

Send, reply, draft, label mutation, trash, or any write. There is no send tool.

---

## 2. Calendar (`calendar`)

Google Calendar via `gog`. Event create/update/delete and RSVP are allowed. Calendar admin is disabled: `calendar.create-calendar`, `calendar.delete-calendar`, `calendar.acl`, `calendar.subscribe`, `calendar.unsubscribe`.

- **Health:** `{ "ok": true, "gog": true }` when `gog` exists.
- **Default calendar:** omit `calendar_id` or pass `""` → `primary`.
- **Datetimes:** RFC 3339 / ISO-8601 strings, max 128 characters. Examples: `2026-09-08T10:00:00-04:00`, `2026-09-08`.
- **Recurring events:** `scope` is `"single"` or `"all"`. `original_start` identifies one instance.

### `list_calendars`

List existing calendars. Does not create or delete them. No arguments.

```json
{}
```

**Returns:** JSON from `gog calendar calendars`.

### `list_events`

List events on one calendar.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `calendar_id` | string | no | 1–256 characters | `primary` |
| `from` | string | no | datetime, max 128 | — |
| `to` | string | no | datetime, max 128 | — |
| `days` | integer | no | 1–90 | `7` if `days` is sent |
| `today` | boolean | no | — | unset |
| `week` | boolean | no | — | unset |
| `query` | string | no | max 500 characters | — |
| `max` | integer | no | 1–50 | `20` |

`today` / `week` / `days` / `from`+`to` are alternative windows. Combine a window with `query` to filter.

```json
{ "today": true, "query": "standup", "max": 5 }
```

```json
{
  "calendar_id": "primary",
  "from": "2026-09-08T00:00:00-04:00",
  "to": "2026-09-14T23:59:59-04:00",
  "max": 50
}
```

**Returns:** JSON from `gog calendar events`.

### `get_event`

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `event_id` | string | yes | 1–256 characters | — |
| `calendar_id` | string | no | 1–256 characters | `primary` |

```json
{ "calendar_id": "primary", "event_id": "abc123" }
```

**Returns:** JSON from `gog calendar event`.

### `search_events`

Free-text search across calendars.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `query` | string | yes | 1–500 characters | — |
| `max` | integer | no | 1–50 | `20` |

```json
{ "query": "dentist", "max": 10 }
```

**Returns:** JSON from `gog calendar search`.

### `create_event`

Create an appointment on an **existing** calendar. Cannot create a calendar.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `summary` | string | yes | 1–2000 characters | — |
| `from` | string | yes | datetime, 1–128 | — |
| `to` | string | yes | datetime, 1–128 | — |
| `calendar_id` | string | no | 1–256 characters | `primary` |
| `description` | string | no | max 8000 | — |
| `location` | string | no | max 2000 | — |
| `attendees` | string[] | no | emails, max 20, each max 320 | — |
| `all_day` | boolean | no | — | false |
| `scope` | `"single"` \| `"all"` | no | recurring writes | — |
| `original_start` | string | no | datetime of one instance | — |

```json
{
  "calendar_id": "primary",
  "summary": "Dentist",
  "from": "2026-09-08T10:00:00-04:00",
  "to": "2026-09-08T10:30:00-04:00",
  "location": "Main St Clinic",
  "description": "Cleaning",
  "attendees": ["ada@example.com"],
  "all_day": false
}
```

All-day:

```json
{
  "summary": "Vacation",
  "from": "2026-09-10",
  "to": "2026-09-15",
  "all_day": true
}
```

**Returns:** JSON from `gog calendar create`.

### `update_event`

Patch an existing event. Same optional write fields as create, plus `event_id`. `summary` / `from` / `to` are optional here.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `event_id` | string | yes | 1–256 characters | — |
| `calendar_id` | string | no | 1–256 characters | `primary` |
| `summary` | string | no | 1–2000 characters | unchanged |
| `from` | string | no | datetime | unchanged |
| `to` | string | no | datetime | unchanged |
| `description` | string | no | max 8000 | unchanged |
| `location` | string | no | max 2000 | unchanged |
| `attendees` | string[] | no | emails, max 20 | unchanged |
| `all_day` | boolean | no | — | — |
| `scope` | `"single"` \| `"all"` | no | recurring | — |
| `original_start` | string | no | instance start | — |

```json
{
  "calendar_id": "primary",
  "event_id": "abc123",
  "summary": "Dentist (moved)",
  "from": "2026-09-08T11:00:00-04:00",
  "to": "2026-09-08T11:30:00-04:00",
  "scope": "single",
  "original_start": "2026-09-08T10:00:00-04:00"
}
```

**Returns:** JSON from `gog calendar update`.

### `delete_event`

Deletes an appointment, not a calendar. Always sent to `gog` with `--force`.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `event_id` | string | yes | 1–256 characters | — |
| `calendar_id` | string | no | 1–256 characters | `primary` |
| `scope` | `"single"` \| `"all"` | no | recurring | — |
| `original_start` | string | no | instance start | — |

```json
{ "calendar_id": "primary", "event_id": "abc123" }
```

**Returns:** JSON from `gog calendar delete`.

### `find_conflicts`

Read-only overlap check.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `calendar_id` | string | no | 1–256 characters | `primary` |
| `from` | string | no | datetime | — |
| `to` | string | no | datetime | — |
| `days` | integer | no | 1–90 | `7` if `days` is sent |
| `today` | boolean | no | — | unset |
| `week` | boolean | no | — | unset |

```json
{ "week": true }
```

**Returns:** JSON from `gog calendar conflicts`.

### `get_freebusy`

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `from` | string | yes | datetime, 1–128 | — |
| `to` | string | yes | datetime, 1–128 | — |
| `calendar_id` | string | no | 1–256 characters | `primary` |

```json
{
  "from": "2026-09-08T09:00:00-04:00",
  "to": "2026-09-08T18:00:00-04:00"
}
```

**Returns:** JSON from `gog calendar freebusy`.

### `respond_event`

RSVP. Not calendar admin.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `event_id` | string | yes | 1–256 characters | — |
| `status` | `"accepted"` \| `"declined"` \| `"tentative"` | yes | — | — |
| `calendar_id` | string | no | 1–256 characters | `primary` |

```json
{ "event_id": "abc123", "status": "tentative" }
```

**Returns:** JSON from `gog calendar respond`.

### Not available

Create/delete calendars, ACL changes, subscribe/unsubscribe.

---

## 3. Messages (`messages`)

Read-only SQLite archive filled by WhatsApp, Google Messages, and Instagram workers. The MCP process mounts the DB **read-only** and never sends.

- **Health:** `{ "ok": true, "readonly": true }`
- **Sources:** `whatsapp`, `gmessages`, `instagram`
- **`chat_id`:** `source:nativeId`, e.g. `whatsapp:family`, `instagram:maya`. Invalid ids error.
- **Timestamps:** `last_message_at`, `sent_at`, and `before_ts` are Unix milliseconds.
- **Full-text search:** operators (`AND`/`OR`/`NOT`/`NEAR`) and punctuation are stripped; the remaining phrase is matched. After stripping, the query must still have at least 2 alphanumeric characters.
- **Search results** include a `snippet`, never the full `body` or `raw_json`.

### `list_recent_conversations`

Recent threads with at least one message, newest first.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `source` | `"whatsapp"` \| `"gmessages"` \| `"instagram"` | no | — | all sources |
| `limit` | integer | no | 1–50 | `20` |
| `before_ts` | number | no | Unix ms; rows with `last_message_at` **&lt;** this | — |

```json
{ "source": "whatsapp", "limit": 10 }
```

Paging: pass the oldest `last_message_at` from the previous page as `before_ts`.

**Returns**

```json
{
  "conversations": [
    {
      "chat_id": "instagram:maya",
      "source": "instagram",
      "title": "Maya",
      "thread_type": "dm",
      "last_message_at": 1700000200000,
      "last_preview": "see you at the gallery"
    }
  ]
}
```

`thread_type` is `dm`, `group`, or `unknown`. `last_preview` is at most 180 characters.

### `get_thread_history`

Recent messages for one chat (newest first). Unknown `chat_id` → error `Unknown chat_id`.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `chat_id` | string | yes | min 3; must parse as `source:nativeId` | — |
| `limit` | integer | no | 1–200 | `50` |
| `before_ts` | number | no | Unix ms; messages with `sent_at` **&lt;** this | — |

```json
{ "chat_id": "whatsapp:family", "limit": 80 }
```

**Returns**

```json
{
  "messages": [
    {
      "id": "whatsapp:wa-1",
      "chat_id": "whatsapp:family",
      "source": "whatsapp",
      "sender": "Dad",
      "direction": "inbound",
      "sent_at": 1700000100000,
      "message_type": "text",
      "body": "dinner at seven with the neighbors",
      "reply_to_id": null
    }
  ]
}
```

Newest first. Use `before_ts` with the oldest `sent_at` from a page to walk further back.

`direction`: `inbound`, `outbound`, `system`.  
`message_type`: `text`, `image`, `video`, `audio`, `document`, `sticker`, `reaction`, `other`.

### `search_messages`

Full-text search over archived bodies. Snippets only.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `query` | string | yes | min 2 characters (and ≥2 alphanumerics after FTS escape) | — |
| `source` | `"whatsapp"` \| `"gmessages"` \| `"instagram"` | no | — | all |
| `chat_id` | string | no | `source:nativeId` if set | all chats |
| `limit` | integer | no | 1–50 | `20` |
| `before_ts` | number | no | Unix ms; `sent_at` **&lt;** this | — |

```json
{ "query": "gallery", "source": "instagram" }
```

```json
{ "query": "dinner", "chat_id": "whatsapp:family", "limit": 20 }
```

**Returns**

```json
{
  "results": [
    {
      "id": "instagram:ig-1",
      "chat_id": "instagram:maya",
      "source": "instagram",
      "sender": "Maya",
      "direction": "inbound",
      "sent_at": 1700000200000,
      "message_type": "text",
      "snippet": "see you at the gallery"
    }
  ]
}
```

Newest matches first. There is no `body` field.

### Not available

Send, reply, react, or any write. Workers ingest; this server only reads.

---

## 4. Mood journal (`mood-journal`)

Writable local journal. The server sets `recorded_at` on create and never accepts client timestamps. Responses use `display_recorded_at` only — raw `recorded_at` / `created_at` / `updated_at` / `deleted_at` are never returned.

- **Health:** `{ "ok": true, "writable": true }`
- **Timezone:** `America/New_York` in compose (`TZ`).
- **Entry id:** UUID.
- **Delete:** soft delete. Deleted rows disappear from get/list/search/aggregates.
- **Tags:** lowercase `[a-z0-9_-]`, 1–32 chars each, max 12, de-duplicated. Invalid example: `NO SPACES`.
- **Dates:** `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, or a `display_recorded_at` string such as `Tuesday, 2026-09-01 8:00:00 AM EDT`. A date-only `from` is start of that local day; a date-only `to` is end of that local day.
- **Search:** same FTS escaping as messages (phrase match, ≥2 alphanumerics after strip).

### Shared field types

| Field | Type | Notes |
| --- | --- | --- |
| `mood`, `energy`, `anxiety`, `sleep_quality` | integer 1–10 | `mood` required on create |
| `note` | string | 1–8000 characters, trimmed, non-empty on create |
| `sleep_hours` | number | 0–24 |
| `social` | enum | `alone`, `one_on_one`, `group` |
| `context` | enum | `home`, `work`, `travel`, `outdoors`, `other` |
| `tags` | string[] | max 12; see tag rules above |
| `id` | UUID | required on get/update/delete |

### Entry object (returned by add/update/get/list)

```json
{
  "id": "8f3c…",
  "display_recorded_at": "Tuesday, 2026-09-01 8:00:00 AM EDT",
  "mood": 8,
  "note": "morning walk in the park felt great",
  "energy": 8,
  "anxiety": 2,
  "sleep_hours": 7.5,
  "sleep_quality": 8,
  "social": "alone",
  "context": "outdoors",
  "tags": ["exercise", "walk"]
}
```

Nullable extras may be `null`.

### `add_entry`

Creates an entry. Timestamp is **now** on the server. Do not send `recorded_at`.

| Argument | Type | Required | Constraints |
| --- | --- | --- | --- |
| `mood` | integer | yes | 1–10 |
| `note` | string | yes | 1–8000, non-empty after trim |
| `energy` | integer | no | 1–10 |
| `anxiety` | integer | no | 1–10 |
| `sleep_hours` | number | no | 0–24 |
| `sleep_quality` | integer | no | 1–10 |
| `social` | enum | no | see above |
| `context` | enum | no | see above |
| `tags` | string[] | no | max 12 |

```json
{
  "mood": 8,
  "note": "morning walk in the park felt great",
  "energy": 8,
  "anxiety": 2,
  "sleep_hours": 7.5,
  "sleep_quality": 8,
  "social": "alone",
  "context": "outdoors",
  "tags": ["walk", "exercise"]
}
```

**Returns:** `{ "entry": { … } }`

### `update_entry`

Patch fields. Cannot change when it was recorded. Omitted fields stay as-is. Sending `tags` **replaces** the tag set.

| Argument | Type | Required | Constraints |
| --- | --- | --- | --- |
| `id` | UUID | yes | — |
| `mood` | integer | no | 1–10 |
| `note` | string | no | 1–8000 |
| `energy` | integer \| null | no | 1–10; `null` clears |
| `anxiety` | integer \| null | no | 1–10; `null` clears |
| `sleep_hours` | number \| null | no | 0–24; `null` clears |
| `sleep_quality` | integer \| null | no | 1–10; `null` clears |
| `social` | enum \| null | no | `null` clears |
| `context` | enum \| null | no | `null` clears |
| `tags` | string[] | no | replaces all tags |

```json
{
  "id": "8f3c…",
  "note": "long meeting drained me (edited)"
}
```

Unknown id → error `Unknown entry`.  
**Returns:** `{ "entry": { … } }`

### `delete_entry`

Soft-delete.

| Argument | Type | Required |
| --- | --- | --- |
| `id` | UUID | yes |

```json
{ "id": "8f3c…" }
```

**Returns:** `{ "id": "8f3c…", "deleted": true }`

### `get_entry`

| Argument | Type | Required |
| --- | --- | --- |
| `id` | UUID | yes |

```json
{ "id": "8f3c…" }
```

**Returns:** `{ "entry": { … } }` or error `Unknown entry`.

### `list_entries`

Newest first. Tag filter is AND (entry must have every listed tag).

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `from` | string | no | date formats above | — |
| `to` | string | no | date formats above | — |
| `before` | string | no | entries with recorded time **before** this | — |
| `mood_min` | integer | no | 1–10 | — |
| `mood_max` | integer | no | 1–10 | — |
| `tags` | string[] | no | max 12 | — |
| `limit` | integer | no | 1–50 | `20` |

```json
{
  "from": "2026-09-01",
  "to": "2026-09-02",
  "mood_max": 5,
  "tags": ["walk"],
  "limit": 10
}
```

**Returns:** `{ "entries": [ { … }, … ] }`

### `search_entries`

Full-text over notes. Snippets only (no full `note`).

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `query` | string | yes | min 2 characters | — |
| `from` | string | no | date | — |
| `to` | string | no | date | — |
| `limit` | integer | no | 1–50 | `20` |

```json
{ "query": "park", "from": "2026-09-01", "to": "2026-09-30" }
```

**Returns**

```json
{
  "results": [
    {
      "id": "8f3c…",
      "display_recorded_at": "Tuesday, 2026-09-01 8:00:00 AM EDT",
      "mood": 8,
      "snippet": "morning walk in the park felt great"
    }
  ]
}
```

### `summarize_range`

Aggregates for a date range (omit `from`/`to` for all entries).

| Argument | Type | Required |
| --- | --- | --- |
| `from` | string | no |
| `to` | string | no |

```json
{ "from": "2026-09-01", "to": "2026-09-02" }
```

**Returns**

```json
{
  "n": 3,
  "mood": { "avg": 6, "min": 4, "max": 8 },
  "energy": { "avg": 5.3, "min": 3, "max": 8 },
  "anxiety": { "avg": 4.5, "min": 2, "max": 7 },
  "sleep": { "avg_hours": 7.5, "avg_quality": 8 },
  "weekday": {
    "Sunday": { "n": 0, "avg_mood": null },
    "Monday": { "n": 0, "avg_mood": null },
    "Tuesday": { "n": 1, "avg_mood": 8 },
    "Wednesday": { "n": 2, "avg_mood": 5 },
    "Thursday": { "n": 0, "avg_mood": null },
    "Friday": { "n": 0, "avg_mood": null },
    "Saturday": { "n": 0, "avg_mood": null }
  },
  "top_tags": [{ "name": "work", "n": 2 }, { "name": "exercise", "n": 1 }]
}
```

Averages are rounded to one decimal. `top_tags` is at most 20, by count then name. Weekdays with no rows have `avg_mood: null`.

### `mood_by_period`

Average mood bucketed by day, ISO week (Monday start), or month.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `period` | `"day"` \| `"week"` \| `"month"` | no | — | `day` |
| `from` | string | no | date | — |
| `to` | string | no | date | — |

```json
{ "period": "day", "from": "2026-09-01", "to": "2026-09-02" }
```

**Returns**

```json
{
  "period": "day",
  "buckets": [
    { "period_start": "2026-09-01", "n": 1, "avg_mood": 8 },
    { "period_start": "2026-09-02", "n": 2, "avg_mood": 5 }
  ]
}
```

`period_start` is `YYYY-MM-DD` for day/week and `YYYY-MM` for month. Week key is that week’s Monday.

### `compare_tagged`

Average mood when a tag is present vs absent.

| Argument | Type | Required | Constraints |
| --- | --- | --- | --- |
| `tag` | string | yes | same rules as a single tag |
| `from` | string | no | date |
| `to` | string | no | date |

```json
{ "tag": "exercise", "from": "2026-09-01", "to": "2026-09-02" }
```

**Returns**

```json
{
  "tag": "exercise",
  "with_tag": { "n": 1, "avg_mood": 8 },
  "without_tag": { "n": 2, "avg_mood": 5 }
}
```

### `list_tags`

Known tags with usage counts (non-deleted entries only). No arguments.

```json
{}
```

**Returns:** `{ "tags": [{ "name": "work", "n": 2 }, …] }` sorted by count desc, then name.

---

## 5. Google Health (`google-health`)

Read-only [Google Health API](https://developers.google.com/health/about) proxy. Sleep and exercise use `dataPoints:reconcile` so overlapping device logs merge. Daily activity uses `dailyRollUp`. GPS / location fields are stripped. Mood-journal sleep fields stay independent (self-reported vs device).

- **Health:** `{ "ok": true, "auth": true }` when `token.json` exists. Does not call Google.
- **Auth:** `${DATA_DIR}/openclaw/google-health-data/{credentials.json,token.json}` mounted at `/data`. Run `scripts/auth.mjs` outside OpenClaw.
- **Scopes:** `googlehealth.sleep.readonly` and `googlehealth.activity_and_fitness.readonly` only.
- **Dates:** `America/New_York`. `from` / `to` are `YYYY-MM-DD` (or `YYYY-MM-DDTHH:mm` / a `display_*` value). Date-only `to` is inclusive of that day. Default window is the last 7 days including today. Max 90 days for sleep/exercise, 14 days for `summarize_activity`.
- **Ids:** short data-point ids from list results, or the full `users/me/dataTypes/…/dataPoints/…` name.

Shared range arguments for `list_sleep`, `list_exercises`, and `summarize_activity`:

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `from` | string | no | date | start of the default window |
| `to` | string | no | date | end of today |
| `days` | integer | no | 1–90 (1–14 for activity) | `7` when no `from`/`to`/`today`/`week` |
| `today` | boolean | no | not with `week` | false |
| `week` | boolean | no | ISO week (Monday start) through today | false |

### `list_sleep`

Reconciled sleep sessions whose wake time falls in the window. At most 50 sessions.

```json
{ "from": "2026-09-01", "to": "2026-09-07" }
```

```json
{ "days": 14 }
```

**Returns**

```json
{
  "sessions": [
    {
      "id": "s1",
      "display_start": "Tuesday, 2026-09-08 10:30:00 PM EDT",
      "display_end": "Wednesday, 2026-09-09 6:30:00 AM EDT",
      "duration_hours": 8,
      "type": "STAGES",
      "stage_minutes": { "light": 240, "deep": 90, "rem": 120, "awake": 30 },
      "short_awakening_count": 2
    }
  ],
  "truncated": false
}
```

`truncated: true` means more than 50 sessions matched. Raw stage samples and short-awakening intervals are omitted.

### `get_sleep`

One sleep session, including stage intervals. Raw `shortAwakenings` are omitted.

| Argument | Type | Required | Constraints |
| --- | --- | --- | --- |
| `id` | string | yes | 1–512 characters |

```json
{ "id": "s1" }
```

**Returns:** `{ "session": { …list fields, "stages": [{ "display_start", "display_end", "type", "minutes" }] } }`

### `list_exercises`

Reconciled exercise sessions whose start time falls in the window. At most 50 sessions. No GPS.

```json
{ "today": true }
```

**Returns**

```json
{
  "sessions": [
    {
      "id": "e1",
      "activity_type": "RUNNING",
      "display_start": "Wednesday, 2026-09-09 10:00:00 AM EDT",
      "display_end": "Wednesday, 2026-09-09 11:00:00 AM EDT",
      "duration_min": 60,
      "calories": 480,
      "distance_m": 8500,
      "steps": 7200,
      "avg_hr": 148
    }
  ],
  "truncated": false
}
```

### `get_exercise`

One exercise session. Laps/events may be included after location fields are stripped.

| Argument | Type | Required | Constraints |
| --- | --- | --- | --- |
| `id` | string | yes | 1–512 characters |

```json
{ "id": "e1" }
```

**Returns:** `{ "session": { …list fields, "events"?, "laps"? } }`

### `summarize_activity`

Per-day steps, active minutes, and total calories. Maximum 14 days.

```json
{ "from": "2026-09-01", "to": "2026-09-07" }
```

**Returns**

```json
{
  "days": [
    { "date": "2026-09-01", "steps": 8000, "active_minutes": 45, "calories": 2200 }
  ]
}
```

Missing metrics are `null`. Data appears after the Fitbit / Google Health app syncs (often ~15 minutes). Phone-only Google Fit / Health Connect history is not available.

---

## Quick reference

| Server | Tools |
| --- | --- |
| `email` | `search_messages`, `get_message`, `get_thread`, `list_labels` |
| `calendar` | `list_calendars`, `list_events`, `get_event`, `search_events`, `create_event`, `update_event`, `delete_event`, `find_conflicts`, `get_freebusy`, `respond_event` |
| `messages` | `list_recent_conversations`, `get_thread_history`, `search_messages` |
| `mood-journal` | `add_entry`, `update_entry`, `delete_entry`, `get_entry`, `list_entries`, `search_entries`, `summarize_range`, `mood_by_period`, `compare_tagged`, `list_tags` |
| `google-health` | `list_sleep`, `get_sleep`, `list_exercises`, `get_exercise`, `summarize_activity` |

`search_messages` exists on both email and messages. They are different tools on different servers (Gmail query vs local FTS).

---

## Capability boundaries

| Action | email | calendar | messages | mood-journal | google-health |
| --- | --- | --- | --- | --- | --- |
| Read personal data | yes | yes | yes | yes | yes |
| Send mail / messages | no | — | no | — | — |
| Create/update/delete events | — | yes | — | — | — |
| Create/delete calendars | — | no | — | — | — |
| Write journal entries | — | — | — | yes | — |
| Write health data | — | — | — | — | no |

Cloud models will see any tool result you send them. Prefer the local-only agents in each project’s `openclaw.*.snippet.json` for mail, calendar, messages, journal, and health data.

Host merge (networks, OpenClaw `mcp.servers` URLs, gog keyring, Google Health tokens) is documented in each project’s `HOST_NOTES.txt`, not here.
