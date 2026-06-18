#!/usr/bin/env bash
# Phase 1 Stremio launch — hide launcher immediately, skip full kill when possible.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export DISPLAY=":0"
export XAUTHORITY="/home/aman/.Xauthority"
export HOME="/home/aman"

bash "$REPO_DIR/scripts/lib/mango-window.sh" hide

if pgrep -x stremio >/dev/null 2>&1 || pgrep -f '/opt/stremio' >/dev/null 2>&1; then
  bash "$REPO_DIR/scripts/phase0/stop-stremio-pad-bridge.sh" 2>/dev/null || true
  bash "$REPO_DIR/scripts/phase0/start-stremio-pad-bridge.sh"
  bash "$REPO_DIR/scripts/phase0/focus-stremio.sh"
  exit 0
fi

exec bash "$REPO_DIR/scripts/phase0/launch-stremio.sh"
