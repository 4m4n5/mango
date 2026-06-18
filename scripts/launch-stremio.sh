#!/usr/bin/env bash
# Phase 1 Stremio — hide launcher as soon as Stremio opens; present TV size in background.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PHASE0="$REPO_DIR/scripts/phase0"
WINDOW_SH="$REPO_DIR/scripts/lib/mango-window.sh"

export DISPLAY=":0"
export XAUTHORITY="/home/aman/.Xauthority"
export HOME="/home/aman"
export MANGO_SKIP_OVERLAY="${MANGO_SKIP_OVERLAY:-1}"

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

focus_and_hide_stremio() {
  bash "$PHASE0/start-stremio-pad-bridge.sh" || true
  bash "$PHASE0/focus-stremio.sh" >/dev/null 2>&1 || true
  bash "$WINDOW_SH" hide
  # Keep resizing until TV-sized without blocking the UI thread.
  (
    for _ in $(seq 1 24); do
      bash "$PHASE0/focus-stremio.sh" >/dev/null 2>&1 && exit 0
      sleep 0.15
    done
  ) &
}

wait_for_stremio_window() {
  local i
  for i in $(seq 1 50); do
    if stremio_window_visible; then
      focus_and_hide_stremio
      return 0
    fi
    sleep 0.15
  done
  return 1
}

if stremio_window_visible; then
  focus_and_hide_stremio
  trap - ERR
  exit 0
fi

if stremio_process_running || stremio_port_busy; then
  bash "$PHASE0/kill-stremio.sh" || true
  stremio_ports_free || true
fi

bash "$PHASE0/launch-stremio.sh" &
LAUNCH_PID=$!

if ! wait_for_stremio_window; then
  wait "$LAUNCH_PID" 2>/dev/null || true
  if stremio_window_visible; then
    focus_and_hide_stremio
  else
    echo "! Stremio window not detected"
    exit 1
  fi
else
  wait "$LAUNCH_PID" 2>/dev/null || true
fi

trap - ERR
