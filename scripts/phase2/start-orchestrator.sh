#!/usr/bin/env bash
# Start mango orchestrator (Phase 2). Run on Pi or Mac from ~/mango.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ORCH_DIR="$REPO_DIR/src/orchestrator"
VENV="$ORCH_DIR/.venv"

export MANGO_CONFIG="${MANGO_CONFIG:-/etc/mango/config.yaml}"

cd "$ORCH_DIR"

if [[ ! -d "$VENV" ]]; then
  echo "Run: bash scripts/phase2/install-orchestrator-deps.sh"
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

HOST="${MANGO_ORCH_HOST:-127.0.0.1}"
PORT="${MANGO_ORCH_PORT:-8765}"

exec python -m orchestrator.main --host "$HOST" --port "$PORT"
