#!/usr/bin/env bash
# Install or upgrade Pi-local AIOMetadata (+ Redis).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
# shellcheck source=../lib/docker-compose.sh
source "$REPO_DIR/scripts/lib/docker-compose.sh"
COMPOSE_DIR="$REPO_DIR/deploy/aiometadata"

cd "$COMPOSE_DIR"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "Created deploy/aiometadata/.env from .env.example — set TMDB_API_KEY and MDBLIST_API_KEY" >&2
  else
    echo "Missing deploy/aiometadata/.env — copy .env.example and set API keys" >&2
    exit 1
  fi
fi

mkdir -p "${MANGO_AIOMETADATA_DATA_DIR:-$HOME/.local/share/mango/aiometadata/data}"
mkdir -p "${MANGO_AIOMETADATA_REDIS_DIR:-$HOME/.local/share/mango/aiometadata/redis}"

docker_compose pull
docker_compose up -d

# shellcheck source=lib/aiometadata.sh
source "$REPO_DIR/scripts/m4-addons/lib/aiometadata.sh"

for _ in $(seq 1 90); do
  if aiometadata_health_ok; then
    echo "AIOMetadata ready: $(aiometadata_configure_url)"
    echo "Health: $(aiometadata_health_url)"
    exit 0
  fi
  sleep 1
done

docker_compose logs --tail=80 aiometadata >&2 || true
echo "AIOMetadata did not become reachable on :3036/health" >&2
exit 1
