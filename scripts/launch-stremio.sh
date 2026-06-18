#!/usr/bin/env bash
# Phase 1 Stremio — fast launch when idle; hide launcher only when TV-sized.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PHASE0="$REPO_DIR/scripts/phase0"
WINDOW_SH="$REPO_DIR/scripts/lib/mango-window.sh"

export DISPLAY=":0"
export XAUTHORITY="/home/aman/.Xauthority"
export HOME="/home/aman"

# shellcheck source=phase0/lib/stremio-ports.sh
source "$PHASE0/lib/stremio-ports.sh"

restore_shell() {
  bash "$WINDOW_SH" show 2>/dev/null || true
}
trap restore_shell ERR

stremio_window_visible() {
  local wid name
  command -v xdotool &>/dev/null || return 1
  for wid in $(xdotool search --class Stremio 2>/dev/null); do
    name=$(xdotool getwindowname "$wid" 2>/dev/null || true)
    [[ "$name" == *"Stremio"* ]] || continue
    [[ "$name" == *"Selection Owner"* ]] && continue
    return 0
  done
  return 1
}

hide_if_tv_sized() {
  if bash "$PHASE0/focus-stremio.sh" >/dev/null 2>&1; then
    bash "$WINDOW_SH" hide
    return 0
  fi
  echo "! Launcher stays visible — Stremio not TV-sized yet"
  return 1
}

if stremio_window_visible; then
  bash "$PHASE0/start-stremio-pad-bridge.sh" || true
  hide_if_tv_sized || true
  trap - ERR
  exit 0
fi

if stremio_process_running || stremio_port_busy; then
  bash "$PHASE0/kill-stremio.sh" || true
  stremio_ports_free || true
fi

bash "$PHASE0/launch-stremio.sh"
hide_if_tv_sized || true
trap - ERR
