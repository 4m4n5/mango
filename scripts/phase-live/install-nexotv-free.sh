#!/usr/bin/env bash
# Install or upgrade Pi-local NexoTV free tier (IPTV-org sports on :7001).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
# shellcheck source=../lib/docker-compose.sh
source "$REPO_DIR/scripts/lib/docker-compose.sh"
COMPOSE_DIR="$REPO_DIR/deploy/nexotv-free"
ENV_FILE="$COMPOSE_DIR/.env"
DATA_DIR="${MANGO_NEXOTV_FREE_DATA_DIR:-$HOME/.local/share/mango/nexotv-free/data}"

cd "$COMPOSE_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE" >&2
  echo "copy .env.example to .env and set CONFIG_SECRET from: openssl rand -hex 32" >&2
  exit 1
fi

if ! grep -Eq '^CONFIG_SECRET=[0-9a-fA-F]{32,}$' "$ENV_FILE"; then
  echo "CONFIG_SECRET must be at least 32 hex chars in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
docker_compose pull
docker_compose up -d

for _ in $(seq 1 60); do
  if curl -sf --max-time 3 http://127.0.0.1:7001/health >/dev/null; then
    echo "NexoTV free ready: http://127.0.0.1:7001/configure"
    exit 0
  fi
  sleep 1
done

docker_compose logs --tail=80 nexotv-free >&2 || true
echo "NexoTV free did not become healthy at /health" >&2
exit 1
