#!/usr/bin/env bash
# Ensure Pi-local AIOStreams .env has maintenance-friendly rate limits (idempotent).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
ENV_FILE="$REPO_DIR/deploy/aiostreams/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "skip: missing $ENV_FILE" >&2
  exit 0
fi

ensure_kv() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    return 0
  fi
  echo "${key}=${value}" >>"$ENV_FILE"
  echo "added ${key}=${value}"
}

ensure_kv DISABLE_RATE_LIMITS true
ensure_kv STREMIO_STREAM_RATE_LIMIT_WINDOW 15
ensure_kv STREMIO_STREAM_RATE_LIMIT_MAX_REQUESTS 60

if docker ps --format '{{.Names}}' | grep -qx mango-aiostreams; then
  # shellcheck source=../lib/docker-compose.sh
  source "$REPO_DIR/scripts/lib/docker-compose.sh"
  cd "$REPO_DIR/deploy/aiostreams"
  docker_compose up -d
  for _ in $(seq 1 30); do
    if curl -sf --max-time 3 http://127.0.0.1:3035/api/v1/status >/dev/null; then
      echo "AIOStreams restarted with rate-limit env"
      exit 0
    fi
    sleep 1
  done
  echo "warn: AIOStreams did not report healthy after restart" >&2
fi
