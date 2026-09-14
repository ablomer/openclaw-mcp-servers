# OpenClaw MCP servers

Custom [MCP](https://modelcontextprotocol.io) servers that sit between [OpenClaw](https://github.com/openclaw/openclaw) and my mail, calendar, messages, journal, health data, and a combined context dump.

OpenClaw already ships MCP, skills, and tools that can reach many of these systems. The point of this repo is not to reinvent that. It is to **keep OpenClaw read-only** (or tightly scoped) and to **reshape the data** so the agent sees what I actually need — not a send-capable plugin, a raw CLI, or an unbounded dump of personal history.

The servers decide which commands exist, which flags are always on, which fields come back, and how large a payload can be. OpenClaw talks to them over Streamable HTTP on internal Docker networks. It never gets the `gog` binary, Gmail tokens, Google Health tokens, chat sessions, or the live SQLite files.

## What is in here

| Project | MCP name | What OpenClaw can do | What it cannot do |
| --- | --- | --- | --- |
| [`gog/email-mcp`](gog/email-mcp) | `email` | Search and read Gmail | Send, reply, draft, label, trash |
| [`gog/calendar-mcp`](gog/calendar-mcp) | `calendar` | List/search events; create, update, delete events; RSVP | Create or delete calendars, change ACLs, subscribe |
| [`messages`](messages) | `messages` | Search a local archive of WhatsApp, Google Messages, and Instagram | Send, reply, react, or write the archive |
| [`mood-journal`](mood-journal) | `mood-journal` | Add, edit, search, and summarize journal entries | Set timestamps (the server owns those) |
| [`google-health`](google-health) | `google-health` | Read sleep, exercise, and daily activity from the Google Health API | Write health data, GPS, HRV, SpO2, weight, nutrition |
| [`context`](context) | `context` | Generate a JSON dump of recent messages, upcoming events, and inbox email | Write anything; call tools other than `generate_context`; read OpenClaw workspace files |

Email, messages, Google Health, and context are strictly read-only. Calendar can write events on calendars that already exist. The mood journal is a dedicated write surface with server-owned timestamps, soft deletes, and aggregate tools.

Full tool schemas, examples, and capability boundaries live in [`MCP_GUIDE.md`](MCP_GUIDE.md).

## How the data is shaped

The interesting work is not “expose Gmail.” It is deciding what the model is allowed to see.

- **Email** always runs `gog` with `--readonly` and `--gmail-no-send`. Bodies are sanitized. Allowed commands are search, get, thread get, and labels list.
- **Calendar** can mutate events, but calendar admin commands are disabled at the `gog` allow-list.
- **Messages** are ingested by workers into SQLite. The MCP process mounts that database **read-only**. Search returns snippets, not full bodies or `raw_json`.
- **Mood journal** never accepts a client timestamp. List/search/aggregates hide deleted rows and raw epoch fields; callers only see `display_recorded_at`.
- **Google Health** live-proxies the Health API with only sleep and activity read scopes. List tools return session summaries; GPS and location are stripped; sleep/exercise lists stop at 50 sessions.
- **Context** calls the messages, calendar, and email MCP servers only. One tool returns the combined JSON. It does not read `MEMORY.md` or daily logs.
- **Every server** returns JSON text. Payloads over 32 KiB (256 KiB for context) are replaced with a truncation stub so a tool call cannot dump an unbounded mailbox or chat history into context.

That is the “tweak the data” part: same sources OpenClaw could already reach, but with a narrower, more useful surface.

## Layout

```
.
├── docker-compose.yml          # OpenClaw + includes the project compose files
├── deploy.sh                   # test, rsync, create networks, build images
├── MCP_GUIDE.md                # tool reference
├── gog/                        # Gmail + Calendar MCP (wraps gog CLI)
├── google-health/              # Fitbit / Pixel Watch sleep and exercise (Health API)
├── messages/                   # ingest workers + read-only MCP
├── mood-journal/               # writable journal MCP + Daylio import
└── context/                    # aggregated mail/calendar/messages dump
```

Each project has its own compose file, tests, and an `openclaw.*.snippet.json` to merge into OpenClaw config. Host-specific merge steps are in each project’s `HOST_NOTES.txt`.

## Architecture

```
                    ┌─────────────────┐
                    │    OpenClaw     │  joins *-internal only
                    └────────┬────────┘
         streamable-http     │
    ┌────────────┬───────────┼────────────┬─────────────────┐
    ▼            ▼           ▼            ▼                 ▼
 email-mcp   calendar-mcp  messages-mcp  mood-journal-mcp  google-health-mcp
 (gog, RO)   (gog, events) (SQLite RO)   (SQLite RW)       (Health API, RO)
    │            │           ▲                                  │
    └──── gog ───┘           │ ingest only                      └── health.googleapis.com
                       whatsapp / gmessages / instagram workers

 OpenClaw ──► context-mcp (aggregate, read-only)
                 └── messages-mcp / calendar-mcp / email-mcp
```

MCP processes listen on `0.0.0.0:3000` inside the container (`/mcp` and `GET /healthz`). They are not published on the host and have no Traefik routes. DNS-rebinding protection is on.

Networks are split on purpose:

- `*-internal` — OpenClaw can reach MCP HTTP here. No egress. `context-mcp` also joins `messages-internal` and `gog-internal` so it can call those servers.
- `*-egress` — workers, `gog`, and google-health-mcp use this to talk to Google / WhatsApp / Instagram. OpenClaw must not join egress networks.
- Backup sidecars use `network_mode: none`.

Containers run read-only root filesystems, drop capabilities, and cap CPU/memory. OpenClaw’s vault and scripts mounts are read-only; the message and journal databases and Google Health token volume are never mounted into OpenClaw.

## Run

You need Docker Compose, Node 20+, and (for the Google Messages worker tests) Go 1.25 or a `golang` image.

```bash
cp .env.example .env          # set DATA_DIR, OPENCLAW_HOST, and deploy targets
# create the Docker networks listed in each project's compose comments
docker compose build
docker compose up -d
```

`deploy.sh` is the path I use: it runs checks/tests, rsyncs the repo to a host, creates networks and volume dirs, and builds images. It does **not** start containers, and it never copies `.env`, `openclaw.json`, SQLite files, or session material.

Before OpenClaw can call the servers:

1. Merge the `openclaw.*.snippet.json` files into the OpenClaw config volume.
2. Attach the OpenClaw service to `messages-internal`, `mood-journal-internal`, `gog-internal`, `google-health-internal`, and `context-internal` only.
3. Authenticate `gog` from an MCP container or a one-shot `gogcli` image — never from OpenClaw. Tokens live in `gog-data/keyring`.
4. Authorize Google Health with `google-health/scripts/auth.mjs` against `google-health-data/` — never from OpenClaw.
5. Pair workers on a trusted tty (WhatsApp QR, Google Messages cookies, Instagram session). Pairing is not an MCP tool.
6. Probe: `openclaw mcp probe email` (and the same for `calendar`, `messages`, `mood-journal`, `google-health`, `context`).

Optional Daylio import for the journal:

```bash
node mood-journal/scripts/import-daylio.mjs path/to/daylio.csv
```

Disable OpenClaw’s native WhatsApp send channel if you use the messages stack. Do not mount `gog`, `gog-data`, or `google-health-data` into the OpenClaw container.

## Tests

```bash
( cd messages && npm run check && npm test )
( cd messages/workers/gmessages && go test ./... )
( cd mood-journal && npm run check && npm test )
( cd gog && npm run check && npm test )
( cd google-health && npm run check && npm test )
( cd context && npm run check && npm test )
```

## Privacy

Cloud models see whatever a tool returns. Query mail, messages, the journal, health data, and the context dump through a **local-only** agent when you can. The snippets pin those agents to a local model, a minimal tool profile, and no web fetch/search.

Do not commit `openclaw.json`, `.env`, `*.sqlite`, `credentials.json`, `token.json`, or anything under `sessions/`. Those are in `.gitignore` for a reason.

Set `GOG_KEYRING_PASSWORD` (and any other secrets) via the environment on the host. Do not put live tokens, cookies, or keyring passwords in compose files you intend to publish.

## License

The Google Messages worker includes [libgm](https://github.com/mautrix/gmessages) and is therefore **AGPL-3.0-or-later**. See [`messages/workers/gmessages/LICENSE`](messages/workers/gmessages/LICENSE) and [`NOTICE`](messages/workers/gmessages/NOTICE). The WhatsApp worker, Instagram worker, MCP servers, and journal stack do not import libgm.
