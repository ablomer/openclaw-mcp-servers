#!/usr/bin/env bash
# Create mood-journal directories owned by MCP uid 65532 (the only writer).
# Unprivileged users cannot chown; we apply ownership via a one-shot Docker
# container (daemon is root) when not running as root.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/srv/containers}"
ROOT="${DATA_DIR}/openclaw/mood-journal-data"

mkdir -p "${ROOT}/db" "${ROOT}/backups"

apply_as_root() {
  chown -R 65532:65532 "${ROOT}/db" "${ROOT}/backups"
  chmod 750 "${ROOT}/db" "${ROOT}/backups"
}

apply_via_docker() {
  docker run --rm \
    -v "${ROOT}:/mood-journal-data" \
    alpine:3.21 \
    sh -c 'set -euo pipefail
      chown -R 65532:65532 /mood-journal-data/db /mood-journal-data/backups
      chmod 750 /mood-journal-data/db /mood-journal-data/backups'
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

echo "Initialized ${ROOT} (db/backups 0750 65532:65532)"
