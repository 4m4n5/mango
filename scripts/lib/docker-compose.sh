#!/usr/bin/env bash
# Resolve docker compose command on Pi OS (plugin vs docker-compose v1).

set -euo pipefail

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi
  echo "docker compose not found — run: bash scripts/phase-n3d/bootstrap-docker.sh" >&2
  exit 1
}
