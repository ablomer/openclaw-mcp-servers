# OpenClaw MCP Server Guide

This repo exposes **six** MCP servers over Streamable HTTP. OpenClaw reaches them on the internal Docker networks; they are not published on the host and have no Traefik routes.

| Server | MCP name | Container | URL | Mode |
| --- | --- | --- | --- | --- |
| Gmail | `email` | `email-mcp` | `http://email-mcp:3000/mcp` | Read-only search/read. Cannot send mail. |
| Calendar | `calendar` | `calendar-mcp` | `http://calendar-mcp:3000/mcp` | Read plus create/update/delete events. Cannot create or delete calendars. |
| Messages | `messages` | `messages-mcp` | `http://messages-mcp:3000/mcp` | Read-only archive of WhatsApp, Google Messages, and Instagram. Cannot send. |
| Mood journal | `mood-journal` | `mood-journal-mcp` | `http://mood-journal-mcp:3000/mcp` | Read/write personal journal. Server owns timestamps. |
| Google Health | `google-health` | `google-health-mcp` | `http://google-health-mcp:3000/mcp` | Read-only sleep, exercise, and daily activity. Cannot write health data. |
| Context | `context` | `context-mcp` | `http://context-mcp:3000/mcp` | Read-only aggregated dump of memories, messages, calendar, and inbox. |

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

`context` is the exception: `generate_context` is an aggregated dump, so its cap is **256 KiB** (`payload exceeded 256KiB cap`).

Email and calendar wrap the `gog` CLI (`--json`). A `gog` timeout (30s) or output over 100 KiB becomes an error result. Google Health calls `health.googleapis.com` with a 30s timeout; sleep/exercise lists stop at 50 sessions. Context calls the messages, calendar, and email MCP servers over the internal Docker networks.

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
- **Default calendar:** omit `calendar_id`, pass `""`, or pass `"primary"`. The server does not send the alias `primary` to gog (gog only accepts ids/names from `list_calendars`). It omits `--cal` and lets gog use the account default.
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
- **Timezone:** `America/New_York` in compose (`TZ`).
- **Sources:** `whatsapp`, `gmessages`, `instagram`
- **Ids:** `chat_id`, message `id`, and `reply_to_id` are `source:nativeId`, e.g. `whatsapp:family`, `instagram:maya`. Malformed ids error `invalid chat_id`.
- **Timestamps:** `list_recent_conversations`, `get_thread_history`, and `search_messages` still use Unix milliseconds for `last_message_at`, `sent_at`, and `before_ts`. `list_messages` uses calendar dates and weekday display times only.
- **Deleted rows:** workers may set `is_deleted`; these queries do not filter it, so deleted messages can still appear.
- **Full-text search:** operators (`AND`/`OR`/`NOT`/`NEAR`) and `"'*(){}[]^~:` are stripped; the remaining phrase is matched. After stripping, at least 2 characters must remain.
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

`thread_type` is `dm`, `group`, or `unknown`. `last_preview` is the body trimmed to 180 characters, with `…` appended if it was cut; empty bodies are `null`.

### `get_thread_history`

Recent messages for one chat (newest first). Malformed `chat_id` → `invalid chat_id`. Unknown `chat_id` → `Unknown chat_id`.

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
`sender` is the contact display name, or `null` if there is no contact row.

### `list_messages`

Messages in a calendar-day range, grouped by thread. Dates are **America/New_York**. No Unix timestamps. The window cannot exceed **14** days (`range exceeds 14 days`). Use only one of `today`, `days`, or `from`/`to`. Date-only `from` is start of that local day; date-only `to` includes that whole day. Omit `from` with `to` set and the window is 3 days ending on `to`.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `from` | string | no | max 128; `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, or a weekday timestamp such as `Tuesday, 2026-09-08 10:00:00 AM EDT` | last 3 days through today, or 3 days ending on `to` |
| `to` | string | no | same formats, max 128; date-only `to` includes that whole day | end of today |
| `days` | integer | no | 1–14; not with `from`/`to` or `today` | `3` when no `from`/`to`/`today` |
| `today` | boolean | no | not with `days` or `from`/`to` | false |
| `source` | `"whatsapp"` \| `"gmessages"` \| `"instagram"` | no | — | all |
| `limit` | integer | no | 1–200 total messages (newest first, then grouped) | `200` |
| `include_empty` | boolean | no | include messages with no body (media-only, stickers, etc.) | `false` |

```json
{ "from": "2026-09-08", "to": "2026-09-10" }
```

```json
{ "days": 3 }
```

**Returns**

```json
{
  "from": "2026-09-08",
  "to": "2026-09-10",
  "truncated": false,
  "threads": [
    {
      "chat_id": "instagram:maya",
      "source": "instagram",
      "title": "Maya",
      "thread_type": "dm",
      "messages": [
        {
          "id": "instagram:ig-2",
          "sender": "Maya",
          "direction": "inbound",
          "sent_at": "Thursday, 2026-09-10 11:00:00 AM EDT",
          "message_type": "text",
          "body": "running a few minutes late",
          "reply_to_id": null
        }
      ]
    }
  ]
}
```

Threads are newest activity first. Messages inside a thread are oldest first (conversation order). By default, rows with a null or whitespace-only `body` are omitted (set `include_empty: true` to keep media-only and other body-less messages). `truncated: true` means more than `limit` messages matched; narrow `from`/`to` or raise `limit`.

### `search_messages`

Full-text search over archived bodies. Snippets only.

| Argument | Type | Required | Constraints | Default |
| --- | --- | --- | --- | --- |
| `query` | string | yes | min 2 characters; after FTS strip, at least 2 characters must remain | — |
| `source` | `"whatsapp"` \| `"gmessages"` \| `"instagram"` | no | — | all |
| `chat_id` | string | no | `source:nativeId` if set; malformed → `invalid chat_id` | all chats |
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

Newest matches first. There is no `body` field. A well-formed but unknown `chat_id` returns an empty `results` list.

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
- **Search:** same FTS escaping as messages (phrase match, ≥2 characters after strip).

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

## 6. Context (`context`)

Read-only aggregate of OpenClaw workspace memories plus the messages, calendar, and email MCP servers. Replaces the old `scripts/generate_context.js` exec helper. Cannot write files or call any mutating tool.

- **Health:** `{ "ok": true, "workspace": true }` when `WORKSPACE_DIR` exists.
- **Sources:** `MEMORY.md` and the last three daily logs under `memory/YYYY-MM-DD.md`; `messages.list_messages` (3 days, limit 30); `calendar.list_events` (next 2 events, 30-day window); `email.search_messages` (`in:inbox newer_than:3m`, max 20) with `get_message` for bodies.
- **Cap:** 256 KiB. Section-level MCP errors are fields on that section (`error`); they do not fail the whole call.
- **Time:** Downstream MCP calls abort after 10s. Inbox bodies are fetched 6 at a time (search snippets if the budget is exhausted). OpenClaw config should set `requestTimeoutMs: 120000` for this server.

### `generate_context`

Build the full context dump. No arguments.

```json
{}
```

**Returns**

```json
{
  "generated_at": "2026-09-10T19:00:00.000Z",
  "memories": {
    "long_term": "I live in Brooklyn.",
    "daily_logs": [
      { "date": "2026-09-10", "content": "shipped context MCP" }
    ]
  },
  "messages": {
    "threads": [
      {
        "title": "Ada",
        "source": "whatsapp",
        "thread_type": "dm",
        "messages": [
          { "sender": "Ada", "sent_at": "2026-09-10 10:00", "body": "hi" }
        ]
      }
    ]
  },
  "calendar": {
    "events": [
      {
        "summary": "Standup",
        "start": "2026-09-11T09:00:00-04:00",
        "end": "2026-09-11T09:30:00-04:00",
        "notes": "daily"
      }
    ]
  },
  "inbox": {
    "threads": [
      {
        "subject": "Invoice",
        "from": "billing@example.com",
        "date": "2026-09-01",
        "body": "Please pay $20"
      }
    ]
  }
}
```

Empty sections use `null` / `[]`. A failed downstream call is `{ "error": "…", "threads": [] }` (or `"events": []` for calendar). Missing `MEMORY.md` is `"long_term": null`.

### Not available

Partial dumps, date-range overrides, or writes. There is no tool other than `generate_context`.

---

## Quick reference

| Server | Tools |
| --- | --- |
| `email` | `search_messages`, `get_message`, `get_thread`, `list_labels` |
| `calendar` | `list_calendars`, `list_events`, `get_event`, `search_events`, `create_event`, `update_event`, `delete_event`, `find_conflicts`, `get_freebusy`, `respond_event` |
| `messages` | `list_recent_conversations`, `get_thread_history`, `list_messages`, `search_messages` |
| `mood-journal` | `add_entry`, `update_entry`, `delete_entry`, `get_entry`, `list_entries`, `search_entries`, `summarize_range`, `mood_by_period`, `compare_tagged`, `list_tags` |
| `google-health` | `list_sleep`, `get_sleep`, `list_exercises`, `get_exercise`, `summarize_activity` |
| `context` | `generate_context` |

`search_messages` exists on both email and messages. They are different tools on different servers (Gmail query vs local FTS).

---

## Capability boundaries

| Action | email | calendar | messages | mood-journal | google-health | context |
| --- | --- | --- | --- | --- | --- | --- |
| Read personal data | yes | yes | yes | yes | yes | yes |
| Send mail / messages | no | — | no | — | — | no |
| Create/update/delete events | — | yes | — | — | — | no |
| Create/delete calendars | — | no | — | — | — | — |
| Write journal entries | — | — | — | yes | — | — |
| Write health data | — | — | — | — | no | — |

Cloud models will see any tool result you send them. Prefer the local-only agents in each project’s `openclaw.*.snippet.json` for mail, calendar, messages, journal, health data, and the context dump.

Host merge (networks, OpenClaw `mcp.servers` URLs, gog keyring, Google Health tokens) is documented in each project’s `HOST_NOTES.txt`, not here.
