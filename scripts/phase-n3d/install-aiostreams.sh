#!/usr/bin/env bash
# Install or upgrade Pi-local AIOStreams.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
COMPOSE_DIR="$REPO_DIR/deploy/aiostreams"
ENV_FILE="$COMPOSE_DIR/.env"
DATA_DIR="${MANGO_AIOSTREAMS_DATA_DIR:-$HOME/.local/share/mango/aiostreams/data}"

cd "$COMPOSE_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE" >&2
  echo "copy .env.example to .env and set SECRET_KEY from: openssl rand -hex 32" >&2
  exit 1
fi

if ! grep -Eq '^SECRET_KEY=[0-9a-fA-F]{64}$' "$ENV_FILE"; then
  echo "SECRET_KEY must be a 64-character hex string in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
docker compose pull
docker compose up -d

for _ in $(seq 1 60); do
  if curl -sf --max-time 3 http://127.0.0.1:3035/api/v1/status >/dev/null; then
    echo "AIOStreams ready: http://127.0.0.1:3035"
    exit 0
  fi
  sleep 1
done

docker compose logs --tail=80 aiostreams >&2 || true
echo "AIOStreams did not become healthy at /api/v1/status" >&2
exit 1
