#!/usr/bin/env bash
# Idempotent orchestrator venv — create/recreate venv and install deps when needed.
# Never rsync .venv between Mac and Pi; this script rebuilds broken copies.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ORCH_DIR="$REPO_DIR/src/orchestrator"
VENV="$ORCH_DIR/.venv"
REQ="$ORCH_DIR/requirements.txt"
PY="$VENV/bin/python"
PIP="$VENV/bin/pip"

if [[ ! -f "$REQ" ]]; then
  echo "missing $REQ" >&2
  exit 1
fi

venv_usable() {
  [[ -x "$PY" ]] || return 1
  "$PY" -c "import sys; assert sys.prefix != sys.base_prefix" >/dev/null 2>&1 || return 1
  return 0
}

deps_ok() {
  venv_usable && "$PY" -c "import fastapi, uvicorn" >/dev/null 2>&1
}

if ! venv_usable; then
  echo "orchestrator: recreating venv at $VENV (missing or host-mismatched — do not rsync .venv)"
  rm -rf "$VENV"
  python3 -m venv "$VENV"
fi

if ! deps_ok; then
  echo "orchestrator: installing Python deps from requirements.txt"
  "$PIP" install --upgrade pip
  "$PIP" install -r "$REQ"
fi

if ! deps_ok; then
  echo "orchestrator: venv still missing fastapi/uvicorn after install" >&2
  exit 1
fi
