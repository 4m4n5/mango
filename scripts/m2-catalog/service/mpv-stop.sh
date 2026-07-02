#!/usr/bin/env bash
# Stop mpv and optionally return to launcher. See docs/ARCHITECTURE.md mpv row.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
GO_HOME="${MANGO_MPV_STOP_HOME:-0}"
HOME_LAUNCHED=0
PLAY_CANCEL_FILE="${MANGO_PLAY_CANCEL_PATH:-${HOME}/.cache/mango/play-cancel.epoch}"
VLC_PID_FILE="${MANGO_VLC_PID_FILE:-${HOME}/.cache/mango/vlc.pid}"
PLAYER_STATE_FILE="${MANGO_PLAYER_STATE_PATH:-${HOME}/.cache/mango/player-state.json}"
VLC_PLAYLIST="${MANGO_VLC_PLAYLIST:-${HOME}/.cache/mango/vlc-play.m3u}"

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
    systemctl --user start mango-launcher-chromium.service >/dev/null 2>&1 || true
    bash "${REPO_DIR}/scripts/launch-launcher.sh" \
      >/dev/null 2>&1 &
  fi
}

vlc_running() {
  if [[ -f "$VLC_PID_FILE" ]] && kill -0 "$(cat "$VLC_PID_FILE")" 2>/dev/null; then
    return 0
  fi
  pgrep -x vlc >/dev/null 2>&1 || pgrep -x cvlc >/dev/null 2>&1
}

stop_vlc() {
  if ! vlc_running; then
    rm -f "$VLC_PID_FILE" "$PLAYER_STATE_FILE" "$VLC_PLAYLIST"
    return 0
  fi
  curl -s --max-time 2 -X POST "http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}/progress/flush" >/dev/null 2>&1 || true
  if [[ -f "$VLC_PID_FILE" ]]; then
    kill "$(cat "$VLC_PID_FILE")" 2>/dev/null || true
  fi
  pkill -x vlc 2>/dev/null || true
  pkill -x cvlc 2>/dev/null || true
  sleep 0.2
  if [[ -f "$VLC_PID_FILE" ]]; then
    kill -9 "$(cat "$VLC_PID_FILE")" 2>/dev/null || true
  fi
  rm -f "$VLC_PID_FILE" "$PLAYER_STATE_FILE" "$VLC_PLAYLIST"
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
stop_vlc

if [[ "${MANGO_MPV_STOP_NO_DISPLAY:-0}" != "1" ]]; then
  bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" launcher 2>/dev/null || true
fi

if [[ "${MANGO_PLAYBACK_BACKEND:-mpv}" == "vlc" ]]; then
  systemctl --user start mango-launcher-chromium.service >/dev/null 2>&1 || true
fi
launch_home_once

exit 0
