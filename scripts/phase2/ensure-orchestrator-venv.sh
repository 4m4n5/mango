#!/usr/bin/env bash
# Idempotent orchestrator venv — create venv and install deps when imports are missing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ORCH_DIR="$REPO_DIR/src/orchestrator"
VENV="$ORCH_DIR/.venv"
REQ="$ORCH_DIR/requirements.txt"

if [[ ! -f "$REQ" ]]; then
  echo "missing $REQ" >&2
  exit 1
fi

if [[ ! -d "$VENV" ]]; then
  echo "orchestrator: creating venv at $VENV"
  python3 -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

if ! python -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "orchestrator: installing Python deps from requirements.txt"
  pip install --upgrade pip
  pip install -r "$REQ"
fi

if ! python -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "orchestrator: venv still missing fastapi/uvicorn after install" >&2
  exit 1
fi
