#!/usr/bin/env bash
# Phase 1 YouTube (Kodi) — TV-native launch; hide launcher when Kodi is ready.

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
  bash "$PHASE0/focus-kodi.sh" >/dev/null 2>&1 || true
  bash "$WINDOW_SH" hide
  (
    for _ in $(seq 1 20); do
      bash "$PHASE0/focus-kodi.sh" >/dev/null 2>&1 && exit 0
      sleep 0.15
    done
  ) &
}

wait_for_kodi_ready() {
  local i
  for i in $(seq 1 80); do
    if kodi_window_visible && kodi_rpc_ready; then
      if ! kodi_youtube_ui_visible; then
        bash "$PHASE0/open-kodi-youtube.sh" >/dev/null 2>&1 || true
      fi
      kodi_youtube_ui_visible || continue
      focus_and_hide_kodi
      return 0
    fi
    sleep 0.2
  done
  return 1
}

if kodi_window_visible && kodi_rpc_ready; then
  bash "$PHASE0/launch-kodi.sh"
  focus_and_hide_kodi
  trap - ERR
  mango_log launch_kodi status=ok mode=warm
  exit 0
fi

bash "$PHASE0/launch-kodi.sh" &
LAUNCH_PID=$!

if ! wait_for_kodi_ready; then
  wait "$LAUNCH_PID" 2>/dev/null || true
  if kodi_window_visible; then
    bash "$PHASE0/open-kodi-youtube.sh" >/dev/null 2>&1 || true
    focus_and_hide_kodi
  else
    echo "! Kodi did not start"
    mango_log launch_kodi status=fail reason=no_window
    exit 1
  fi
else
  wait "$LAUNCH_PID" 2>/dev/null || true
fi

trap - ERR
mango_log launch_kodi status=ok
