#!/usr/bin/env bash
# Deploy this repo into ${DATA_DIR}/openclaw on the production host.
# Syncs files, prepares networks/volumes, and builds images (does not start
# containers). Compose/BuildKit cache rebuilds only layers whose context changed.
# Never rsync openclaw.json, .env, live OpenClaw data, sessions, or sqlite files.
#
# Override via env or a local .env: REMOTE_HOST, REMOTE_USER, SSH_KEY, DATA_DIR, REMOTE_DIR

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MESSAGES_DIR="${SCRIPT_DIR}/messages"
MOOD_JOURNAL_DIR="${SCRIPT_DIR}/mood-journal"
GOG_DIR="${SCRIPT_DIR}/gog"

if [ -f "${SCRIPT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${SCRIPT_DIR}/.env"
  set +a
fi

REMOTE_HOST="${REMOTE_HOST}"
REMOTE_USER="${REMOTE_USER}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"
DATA_DIR="${DATA_DIR:-/srv/containers}"
REMOTE_DIR="${REMOTE_DIR:-${DATA_DIR}/openclaw}"

SSH_OPTS=(
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=accept-new
)

COMMON_ARGS=("${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}")

cd "$SCRIPT_DIR"

need=(
  docker-compose.yml
  messages/docker-compose.yml
  messages/mcp-server/src/index.js
  messages/packages/shared/src/schema.sql
  messages/workers/whatsapp/src/index.js
  messages/workers/gmessages/go.mod
  messages/workers/gmessages/cmd/gmessages-worker/main.go
  messages/workers/instagram/src/index.js
  messages/scripts/init-volumes.sh
  messages/scripts/backup.mjs
  mood-journal/docker-compose.yml
  mood-journal/mcp-server/src/index.js
  mood-journal/packages/shared/src/schema.sql
  mood-journal/scripts/init-volumes.sh
  mood-journal/scripts/backup.mjs
  gog/docker-compose.yml
  gog/email-mcp/src/index.js
  gog/calendar-mcp/src/index.js
  gog/packages/shared/src/gog.js
)
for f in "${need[@]}"; do
  [ -f "$f" ] || { echo "Missing $f in ${SCRIPT_DIR}" >&2; exit 1; }
done

( cd "$MESSAGES_DIR" && npm run check && npm test )
if command -v go >/dev/null 2>&1; then
  ( cd "$MESSAGES_DIR/workers/gmessages" && go test ./... )
else
  docker run --rm -v "$MESSAGES_DIR/workers/gmessages:/src" -w /src golang:1.25-bookworm go test ./...
fi
( cd "$MOOD_JOURNAL_DIR" && npm run check && npm test )
( cd "$GOG_DIR" && npm run check && npm test )

ssh "${COMMON_ARGS[@]}" "mkdir -p \"${REMOTE_DIR}\" \"${DATA_DIR}/openclaw/messages-data/db\" \"${DATA_DIR}/openclaw/messages-data/sessions\" \"${DATA_DIR}/openclaw/messages-data/backups\" \"${DATA_DIR}/openclaw/mood-journal-data/db\" \"${DATA_DIR}/openclaw/mood-journal-data/backups\" \"${DATA_DIR}/openclaw/gog-data/keyring\""

RSYNC_RSH="ssh ${SSH_OPTS[*]}"
rsync -az --delete -e "$RSYNC_RSH" \
  --exclude node_modules \
  --exclude .git \
  --exclude .env \
  --exclude openclaw.json \
  --exclude '*.sqlite' \
  --exclude '*.sqlite-wal' \
  --exclude '*.sqlite-shm' \
  --exclude /data \
  --exclude /vault \
  --exclude /scripts \
  --exclude /edits \
  --exclude /bin \
  --exclude /gogcli \
  --exclude /gog-data \
  --exclude /ntfy-bridge \
  --exclude /messages-data \
  --exclude /mood-journal-data \
  --exclude /db_data \
  --exclude /sessions \
  --exclude /backups \
  "${SCRIPT_DIR}/" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"

ssh "${COMMON_ARGS[@]}" bash -s <<EOF
set -euo pipefail
export DATA_DIR="${DATA_DIR}"
bash "${REMOTE_DIR}/messages/scripts/init-volumes.sh"
bash "${REMOTE_DIR}/mood-journal/scripts/init-volumes.sh"
docker network inspect messages-internal >/dev/null 2>&1 || docker network create --internal messages-internal
docker network inspect messages-egress >/dev/null 2>&1 || docker network create messages-egress
docker network inspect mood-journal-internal >/dev/null 2>&1 || docker network create --internal mood-journal-internal
docker network inspect gog-internal >/dev/null 2>&1 || docker network create --internal gog-internal
docker network inspect gog-egress >/dev/null 2>&1 || docker network create gog-egress
cd "${REMOTE_DIR}"
DATA_DIR="${DATA_DIR}" docker compose -f docker-compose.yml build
echo
echo "OpenClaw project: ${REMOTE_DIR}"
echo "Images built. Start or recreate containers when ready:"
echo "  cd ${REMOTE_DIR} && DATA_DIR=${DATA_DIR} docker compose -f docker-compose.yml up -d"
echo "MCP: messages-mcp:3000/mcp on messages-internal (no published ports)"
echo "MCP: mood-journal-mcp:3000/mcp on mood-journal-internal (no published ports)"
echo "MCP: email-mcp:3000/mcp and calendar-mcp:3000/mcp on gog-internal (no published ports)"
echo "Pair WhatsApp: docker compose logs -f whatsapp-worker"
echo "Pair Google Messages: write cookies.json or cookies.curl to ${DATA_DIR}/openclaw/messages-data/sessions/gmessages and confirm the emoji on the phone"
echo "Instagram session: ${DATA_DIR}/openclaw/messages-data/sessions/instagram/session.json"
echo "Merge messages/openclaw.messages.snippet.json into ${DATA_DIR}/openclaw/data (openclaw.json)."
echo "Merge mood-journal/openclaw.mood-journal.snippet.json into ${DATA_DIR}/openclaw/data (openclaw.json)."
echo "Merge gog/openclaw.gog.snippet.json into ${DATA_DIR}/openclaw/data (openclaw.json)."
echo "Then: docker exec <openclaw> openclaw mcp probe messages-readonly"
echo "Then: docker exec <openclaw> openclaw mcp probe mood-journal"
echo "Then: docker exec <openclaw> openclaw mcp probe email-readonly"
echo "Then: docker exec <openclaw> openclaw mcp probe calendar"
EOF

echo "Deployed to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"
