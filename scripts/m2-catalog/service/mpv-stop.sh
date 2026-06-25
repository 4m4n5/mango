#!/usr/bin/env bash
# Stop mpv and optionally return to launcher. See docs/ARCHITECTURE.md mpv row.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
GO_HOME="${MANGO_MPV_STOP_HOME:-0}"
HOME_LAUNCHED=0
PLAY_CANCEL_FILE="${MANGO_PLAY_CANCEL_PATH:-${HOME}/.cache/mango/play-cancel.epoch}"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../../lib/launcher-window.sh
source "$REPO_DIR/scripts/lib/launcher-window.sh"

if [[ -x "$REPO_DIR/scripts/lib/couch-activity.sh" ]]; then
  bash "$REPO_DIR/scripts/lib/couch-activity.sh" touch mpv stop >/dev/null 2>&1 || true
fi

if [[ "${MANGO_MPV_STOP_NO_CANCEL:-0}" != "1" ]]; then
  mkdir -p "$(dirname "$PLAY_CANCEL_FILE")"
  date +%s%3N >"$PLAY_CANCEL_FILE" 2>/dev/null || date +%s >"$PLAY_CANCEL_FILE"
fi

launch_home_once() {
  if [[ "${GO_HOME}" == "1" && "$HOME_LAUNCHED" -eq 0 ]]; then
    HOME_LAUNCHED=1
    bash "${REPO_DIR}/scripts/launch-launcher.sh" \
      >/dev/null 2>&1 &
  fi
}

trigger_library_refresh() {
  curl -sf --max-time 2 -X POST "http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}/playability/session/reshuffle" \
    >/dev/null 2>&1 || true
  if command -v xdotool >/dev/null 2>&1; then
    local wid
    wid="$(find_launcher_wid 2>/dev/null || true)"
    if [[ -n "$wid" ]]; then
      xdotool key --window "$wid" F5 >/dev/null 2>&1 || true
    fi
  fi
}

if [[ -S "$SOCKET" ]]; then
  curl -s --max-time 2 -X POST "http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}/progress/flush" >/dev/null 2>&1 || true
  if command -v timeout >/dev/null 2>&1; then
    echo '{"command":["quit"]}' | timeout 1s socat - "$SOCKET" >/dev/null 2>&1 || true
  else
    echo '{"command":["quit"]}' | socat - "$SOCKET" >/dev/null 2>&1 || true
  fi
  launch_home_once
  sleep 0.2
fi

pkill -x mpv 2>/dev/null || true
rm -f "${HOME}/.cache/mango/mpv.pid" "$SOCKET"

if [[ "${MANGO_MPV_STOP_NO_DISPLAY:-0}" != "1" ]]; then
  bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" launcher 2>/dev/null || true
fi

launch_home_once

if [[ "${GO_HOME}" == "1" ]]; then
  trigger_library_refresh
fi

exit 0
