#!/usr/bin/env bash
# SSOT: show and focus the launcher after mpv playback ends.
#
# Usage:
#   restore-launcher-after-playback.sh prepare  # map/present launcher before mpv teardown
#   restore-launcher-after-playback.sh finish   # xrandr + focus after mpv is gone
#
# Env:
#   MANGO_MPV_STOP_HOME=1  run launch-launcher (pad home path)

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export MANGO_SKIP_OVERLAY="${MANGO_SKIP_OVERLAY:-1}"

PLAYBACK_ACTIVE_FILE="${MANGO_PLAYBACK_ACTIVE_FILE:-${HOME}/.cache/mango/playback-active}"
GO_HOME="${MANGO_MPV_STOP_HOME:-0}"
STEP_SEC="${MANGO_LAUNCHER_RESTORE_STEP_SEC:-0.05}"
MAX_ATTEMPTS="${MANGO_LAUNCHER_RESTORE_ATTEMPTS:-60}"

# shellcheck source=launcher-window.sh
source "$REPO_DIR/scripts/lib/launcher-window.sh"

ensure_launcher_browser() {
  if pgrep -f "$(launcher_browser_pattern)" >/dev/null 2>&1; then
    return 0
  fi
  systemctl --user start mango-launcher-chromium.service >/dev/null 2>&1 || true
}

show_launcher_surface() {
  ensure_launcher_browser
  bash "$REPO_DIR/scripts/lib/mango-window.sh" show 2>/dev/null || true
}

present_launcher_ready() {
  local attempt wid
  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
    ensure_launcher_browser
    show_launcher_surface
    wid="$(find_launcher_wid 2>/dev/null || true)"
    if [[ -n "$wid" ]]; then
      if bash "$REPO_DIR/scripts/lib/present-launcher.sh" --quick 2>/dev/null \
        || bash "$REPO_DIR/scripts/lib/present-launcher.sh" 2>/dev/null; then
        return 0
      fi
    fi
    sleep "$STEP_SEC"
  done
  return 1
}

focus_launcher_home() {
  [[ "${GO_HOME}" == "1" ]] || return 0
  bash "$REPO_DIR/scripts/launch-launcher.sh" >/dev/null 2>&1 &
}

cmd_prepare() {
  show_launcher_surface
  present_launcher_ready || true
}

cmd_finish() {
  rm -f "$PLAYBACK_ACTIVE_FILE"
  bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" ensure-launcher 2>/dev/null || true
  show_launcher_surface
  present_launcher_ready || true
  focus_launcher_home
  bash "$REPO_DIR/scripts/lib/mango-cursor.sh" hide 2>/dev/null || true
}

case "${1:-finish}" in
  prepare) cmd_prepare ;;
  finish|full) cmd_finish ;;
  *)
    echo "usage: $0 prepare|finish|full" >&2
    exit 2
    ;;
esac
