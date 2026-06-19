#!/usr/bin/env bash
# Install or upgrade Pi-local AIOLists.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
# shellcheck source=../lib/docker-compose.sh
source "$REPO_DIR/scripts/lib/docker-compose.sh"
COMPOSE_DIR="$REPO_DIR/deploy/aiolists"

cd "$COMPOSE_DIR"
docker_compose build
docker_compose up -d

for _ in $(seq 1 60); do
  if curl -sf --max-time 3 http://127.0.0.1:3036/manifest.json >/dev/null \
    || curl -sf --max-time 3 http://127.0.0.1:3036/ >/dev/null; then
    echo "AIOLists ready: http://127.0.0.1:3036"
    exit 0
  fi
  sleep 1
done

docker_compose logs --tail=80 aiolists >&2 || true
echo "AIOLists did not become reachable on :3036" >&2
exit 1
