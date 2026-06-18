#!/usr/bin/env bash
# Phase 1 YouTube (Kodi) — TV-native launch; hide launcher when YouTube UI is ready.

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
mango_log launch_kodi status=start

LOCK_DIR="${HOME}/.cache/mango"
LOCK_FILE="${LOCK_DIR}/launch-kodi.lock"
mkdir -p "$LOCK_DIR"

release_launch_lock() {
  flock -u 9 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  mango_log launch_kodi status=busy
  release_launch_lock
  exit 0
fi

# shellcheck source=phase0/lib/kodi-rpc.sh
source "$PHASE0/lib/kodi-rpc.sh"

restore_shell() {
  bash "$WINDOW_SH" show 2>/dev/null || true
}
trap restore_shell ERR

kodi_window_visible() {
  command -v xdotool &>/dev/null || return 1
  xdotool search --class Kodi 2>/dev/null | grep -q .
}

focus_and_hide_kodi() {
  export MANGO_KODI_OPEN_YOUTUBE=1
  bash "$PHASE0/focus-kodi.sh" >/dev/null 2>&1 || true
  unset MANGO_KODI_OPEN_YOUTUBE
  bash "$WINDOW_SH" hide
}

ensure_kodi_youtube_ui() {
  local attempt opened=0
  for attempt in $(seq 1 40); do
    if kodi_youtube_ui_visible; then
      return 0
    fi
    if [[ $opened -eq 0 ]] && kodi_window_visible && kodi_rpc_ready; then
      opened=1
      bash "$PHASE0/open-kodi-youtube.sh" >/dev/null 2>&1 || true
    fi
    sleep 0.15
  done
  echo "! Kodi YouTube UI (window 10025) not reached" >&2
  return 1
}

finish_kodi_launch() {
  local mode=${1:-cold}
  if ! ensure_kodi_youtube_ui; then
    mango_log launch_kodi status=fail reason=youtube_window
    exit 1
  fi
  focus_and_hide_kodi
  trap - ERR
  mango_log launch_kodi status=ok mode="$mode"
}

if kodi_window_visible && kodi_rpc_ready; then
  release_launch_lock
  bash "$PHASE0/launch-kodi.sh"
  finish_kodi_launch warm
  exit 0
fi

release_launch_lock

bash "$PHASE0/launch-kodi.sh" &
LAUNCH_PID=$!

for _ in $(seq 1 90); do
  if kodi_window_visible && kodi_rpc_ready; then
    wait "$LAUNCH_PID" 2>/dev/null || true
    finish_kodi_launch cold
    exit 0
  fi
  sleep 0.2
done

wait "$LAUNCH_PID" 2>/dev/null || true
if kodi_window_visible && kodi_rpc_ready; then
  finish_kodi_launch cold
  exit 0
fi

echo "! Kodi did not start"
mango_log launch_kodi status=fail reason=no_window
exit 1
