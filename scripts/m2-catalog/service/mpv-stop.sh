#!/usr/bin/env bash
# Stop mpv and optionally return to launcher. See docs/ARCHITECTURE.md mpv row.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
GO_HOME="${MANGO_MPV_STOP_HOME:-0}"
HOME_LAUNCHED=0
PLAY_CANCEL_FILE="${MANGO_PLAY_CANCEL_PATH:-${HOME}/.cache/mango/play-cancel.epoch}"
PLAYBACK_OSD_PID_FILE="${MANGO_PLAYBACK_OSD_PID_FILE:-${HOME}/.cache/mango/playback-osd.pid}"
PLAYBACK_OSD_TRIGGER="${MANGO_PLAYBACK_OSD_TRIGGER:-${HOME}/.cache/mango/playback-osd.show}"
PLAYBACK_ACTIVE_FILE="${MANGO_PLAYBACK_ACTIVE_FILE:-${HOME}/.cache/mango/playback-active}"
LEGACY_VLC_PID_FILE="${MANGO_VLC_PID_FILE:-${HOME}/.cache/mango/vlc.pid}"
LEGACY_PLAYER_STATE="${MANGO_PLAYER_STATE_PATH:-${HOME}/.cache/mango/player-state.json}"
LEGACY_VLC_PLAYLIST="${MANGO_VLC_PLAYLIST:-${HOME}/.cache/mango/vlc-play.m3u}"

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

stop_playback_osd() {
  if [[ -f "$PLAYBACK_OSD_PID_FILE" ]]; then
    kill "$(cat "$PLAYBACK_OSD_PID_FILE")" 2>/dev/null || true
    sleep 0.1
    kill -9 "$(cat "$PLAYBACK_OSD_PID_FILE")" 2>/dev/null || true
  fi
  rm -f "$PLAYBACK_OSD_PID_FILE" "$PLAYBACK_OSD_TRIGGER"
}

if [[ -S "$SOCKET" ]]; then
  curl -s --max-time 2 -X POST "http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}/progress/flush" >/dev/null 2>&1 || true
  if command -v timeout >/dev/null 2>&1; then
    echo '{"command":["quit"]}' | timeout 1s socat - "$SOCKET" >/dev/null 2>&1 || true
  else
    echo '{"command":["quit"]}' | socat - "$SOCKET" >/dev/null 2>&1 || true
  fi
  sleep 0.2
fi

pkill -x mpv 2>/dev/null || true
stop_playback_osd
rm -f "${HOME}/.cache/mango/mpv.pid" "$SOCKET" "$PLAYBACK_ACTIVE_FILE" \
  "$LEGACY_VLC_PID_FILE" "$LEGACY_PLAYER_STATE" "$LEGACY_VLC_PLAYLIST"

if [[ "${MANGO_MPV_STOP_NO_DISPLAY:-0}" != "1" ]]; then
  bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" launcher 2>/dev/null || true
fi

# Restore the Chromium launcher on a real stop (couch mpv stops it for a
# tear-free foreground). Probe / pre-play cleanup passes MANGO_MPV_STOP_NO_DISPLAY=1.
if [[ "${MANGO_MPV_STOP_NO_DISPLAY:-0}" != "1" ]]; then
  systemctl --user start mango-launcher-chromium.service >/dev/null 2>&1 || true
fi
launch_home_once

exit 0
