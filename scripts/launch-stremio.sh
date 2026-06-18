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

# shellcheck source=lib/mango-log.sh
source "$REPO_DIR/scripts/lib/mango-log.sh"
mango_log launch_stremio status=start

LOCK_DIR="${HOME}/.cache/mango"
LOCK_FILE="${LOCK_DIR}/launch-stremio.lock"
mkdir -p "$LOCK_DIR"

release_launch_lock() {
  flock -u 9 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
}

acquire_launch_lock() {
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    if ! flock -w 3 9; then
      mango_log launch_stremio status=busy
      release_launch_lock
      return 1
    fi
  fi
  return 0
}

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

stremio_is_foreground() {
  local active
  active=$(xdotool getactivewindow getwindowname 2>/dev/null || true)
  [[ "$active" == *"Stremio"* ]]
}

stremio_has_orphan_windows() {
  stremio_window_visible && ! stremio_process_running
}

cleanup_stremio_orphan_windows() {
  local wid
  command -v xdotool &>/dev/null || return 0
  for wid in $(xdotool search --class Stremio 2>/dev/null); do
    xdotool windowunmap "$wid" 2>/dev/null || true
  done
}

refocus_stremio_from_launcher() {
  if ! pgrep -f mango-tv-pad.py >/dev/null 2>&1; then
    bash "$PHASE0/start-mango-tv-pad.sh" 2>/dev/null || bash "$PHASE0/start-stremio-pad-bridge.sh" || true
  fi

  local attempt
  for attempt in $(seq 1 15); do
    bash "$PHASE0/present-stremio.sh" 2>/dev/null || bash "$PHASE0/focus-stremio.sh" >/dev/null 2>&1 || true
    if stremio_is_foreground; then
      bash "$WINDOW_SH" hide 2>/dev/null || true
      bash "$REPO_DIR/scripts/lib/mango-cursor.sh" hide 2>/dev/null || true
      return 0
    fi
    sleep 0.15
  done

  return 1
}

wait_for_stremio_window() {
  local i
  for i in $(seq 1 50); do
    if stremio_window_visible; then
      refocus_stremio_from_launcher
      return 0
    fi
    sleep 0.15
  done
  return 1
}

if ! acquire_launch_lock; then
  exit 0
fi

if stremio_process_running; then
  release_launch_lock
  if refocus_stremio_from_launcher; then
    trap - ERR
    mango_log launch_stremio status=ok mode=refocus
    exit 0
  fi
  bash "$WINDOW_SH" show 2>/dev/null || true
  echo "! Stremio refocus failed"
  mango_log launch_stremio status=fail reason=refocus
  exit 1
fi

if stremio_has_orphan_windows; then
  cleanup_stremio_orphan_windows
fi

release_launch_lock

if stremio_process_running || stremio_port_busy; then
  bash "$PHASE0/kill-stremio.sh" || true
  stremio_ports_free || true
fi

bash "$PHASE0/launch-stremio.sh" &
LAUNCH_PID=$!

if ! wait_for_stremio_window; then
  wait "$LAUNCH_PID" 2>/dev/null || true
  if stremio_window_visible; then
    refocus_stremio_from_launcher
  else
    echo "! Stremio window not detected"
    mango_log launch_stremio status=fail reason=no_window
    exit 1
  fi
else
  wait "$LAUNCH_PID" 2>/dev/null || true
fi

trap - ERR
mango_log launch_stremio status=ok
