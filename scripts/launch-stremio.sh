#!/usr/bin/env bash
# Phase 1 Stremio launch — use the proven Phase 0 reset path; hide launcher only after success.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WINDOW_SH="$REPO_DIR/scripts/lib/mango-window.sh"

export DISPLAY=":0"
export XAUTHORITY="/home/aman/.Xauthority"
export HOME="/home/aman"

restore_shell() {
  bash "$WINDOW_SH" show 2>/dev/null || true
}
trap restore_shell ERR

stremio_window_visible() {
  local wid name
  command -v xdotool &>/dev/null || return 1
  for wid in $(xdotool search --name Stremio 2>/dev/null); do
    name=$(xdotool getwindowname "$wid" 2>/dev/null || true)
    if [[ "$name" == "Stremio" ]]; then
      return 0
    fi
  done
  return 1
}

if stremio_window_visible; then
  bash "$REPO_DIR/scripts/phase0/stop-stremio-pad-bridge.sh" 2>/dev/null || true
  bash "$REPO_DIR/scripts/phase0/start-stremio-pad-bridge.sh" || true
  bash "$REPO_DIR/scripts/phase0/focus-stremio.sh"
  bash "$WINDOW_SH" hide
  trap - ERR
  exit 0
fi

bash "$REPO_DIR/scripts/phase0/reset-stremio.sh"
bash "$WINDOW_SH" hide
trap - ERR
