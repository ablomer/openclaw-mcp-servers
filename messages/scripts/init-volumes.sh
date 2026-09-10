#!/usr/bin/env bash
# Create message-store directories with worker uid 1000 and MCP group 65532.
# Workers write 640 files (umask 027); MCP 65532 can read; kernel :ro blocks MCP writes.
# Unprivileged users cannot chown; we apply ownership via a one-shot Docker container
# (daemon is root) when not running as root.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/srv/containers}"
ROOT="${DATA_DIR}/openclaw/messages-data"

mkdir -p "${ROOT}/db" "${ROOT}/sessions/whatsapp" "${ROOT}/sessions/gmessages" \
  "${ROOT}/sessions/instagram" "${ROOT}/backups"

apply_as_root() {
  chown -R 1000:65532 "${ROOT}/db" "${ROOT}/backups"
  chmod 750 "${ROOT}/db" "${ROOT}/backups"
  chown -R 1000:1000 "${ROOT}/sessions"
  chmod 700 "${ROOT}/sessions"
  chmod 700 "${ROOT}/sessions/whatsapp" "${ROOT}/sessions/gmessages" "${ROOT}/sessions/instagram"
}

apply_via_docker() {
  docker run --rm \
    -v "${ROOT}:/messages-data" \
    alpine:3.21 \
    sh -c 'set -euo pipefail
      chown -R 1000:65532 /messages-data/db /messages-data/backups
      chmod 750 /messages-data/db /messages-data/backups
      chown -R 1000:1000 /messages-data/sessions
      chmod 700 /messages-data/sessions \
        /messages-data/sessions/whatsapp \
        /messages-data/sessions/gmessages \
        /messages-data/sessions/instagram'
}

if [ "$(id -u)" -eq 0 ]; then
  apply_as_root
elif command -v docker >/dev/null 2>&1; then
  apply_via_docker
else
  echo "Cannot chown ${ROOT}: not root and docker is unavailable." >&2
  echo "Run this script as root or install Docker." >&2
  exit 1
fi

echo "Initialized ${ROOT} (db/backups 0750 1000:65532, sessions 0700 1000:1000)"
