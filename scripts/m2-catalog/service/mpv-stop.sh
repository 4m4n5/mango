#!/usr/bin/env bash
# Stop mpv and optionally return to launcher. See docs/ARCHITECTURE.md mpv row.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
GO_HOME="${MANGO_MPV_STOP_HOME:-0}"
PLAY_CANCEL_FILE="${MANGO_PLAY_CANCEL_PATH:-${HOME}/.cache/mango/play-cancel.epoch}"
PLAYBACK_OSD_PID_FILE="${MANGO_PLAYBACK_OSD_PID_FILE:-${HOME}/.cache/mango/playback-osd.pid}"
PLAYBACK_OSD_TRIGGER="${MANGO_PLAYBACK_OSD_TRIGGER:-${HOME}/.cache/mango/playback-osd.show}"
PLAYBACK_ACTIVE_FILE="${MANGO_PLAYBACK_ACTIVE_FILE:-${HOME}/.cache/mango/playback-active}"
PLAYBACK_DISPLAY_MATCHED_FILE="${MANGO_PLAYBACK_DISPLAY_MATCHED_FILE:-${HOME}/.cache/mango/playback-display-matched}"
MPV_PID_FILE="${MANGO_MPV_PID_FILE:-${HOME}/.cache/mango/mpv.pid}"
LEGACY_VLC_PID_FILE="${MANGO_VLC_PID_FILE:-${HOME}/.cache/mango/vlc.pid}"
LEGACY_PLAYER_STATE="${MANGO_PLAYER_STATE_PATH:-${HOME}/.cache/mango/player-state.json}"
LEGACY_VLC_PLAYLIST="${MANGO_VLC_PLAYLIST:-${HOME}/.cache/mango/vlc-play.m3u}"
RESTORE_SH="$REPO_DIR/scripts/lib/restore-launcher-after-playback.sh"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../../lib/launcher-window.sh
source "$REPO_DIR/scripts/lib/launcher-window.sh"
# shellcheck source=../../lib/mango-playback-env.sh
source "$REPO_DIR/scripts/lib/mango-playback-env.sh"

if [[ -x "$REPO_DIR/scripts/lib/couch-activity.sh" ]]; then
  bash "$REPO_DIR/scripts/lib/couch-activity.sh" touch mpv stop >/dev/null 2>&1 || true
fi

if [[ "${MANGO_MPV_STOP_NO_CANCEL:-0}" != "1" ]]; then
  mkdir -p "$(dirname "$PLAY_CANCEL_FILE")"
  date +%s%3N >"$PLAY_CANCEL_FILE" 2>/dev/null || date +%s >"$PLAY_CANCEL_FILE"
fi

stop_playback_osd() {
  if [[ -f "$PLAYBACK_OSD_PID_FILE" ]]; then
    kill "$(cat "$PLAYBACK_OSD_PID_FILE")" 2>/dev/null || true
    sleep 0.1
    kill -9 "$(cat "$PLAYBACK_OSD_PID_FILE")" 2>/dev/null || true
  fi
  if pgrep -f 'playback-osd\.py --run' >/dev/null 2>&1; then
    pkill -f 'playback-osd\.py --run' 2>/dev/null || true
    sleep 0.1
  fi
  rm -f "$PLAYBACK_OSD_PID_FILE" "$PLAYBACK_OSD_TRIGGER"
}

tracked_pid_is_mango_mpv() {
  local pid="$1"
  local command_line=""
  command_line="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command_line" == *mpv* && "$command_line" == *"--input-ipc-server=$SOCKET"* ]]
}

signal_tracked_mpv() {
  local pid="$1"
  local signal="$2"
  local pgid=""
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -dc '0-9' || true)"
  if [[ "$pgid" == "$pid" ]]; then
    kill -s "$signal" -- "-$pgid" 2>/dev/null || true
  else
    kill -s "$signal" "$pid" 2>/dev/null || true
  fi
}

teardown_mpv() {
  local tracked_pid=""
  if [[ -f "$MPV_PID_FILE" ]]; then
    tracked_pid="$(tr -dc '0-9' <"$MPV_PID_FILE" 2>/dev/null || true)"
  fi
  if [[ -S "$SOCKET" ]]; then
    curl -s --max-time 2 -X POST "http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}/progress/flush" >/dev/null 2>&1 || true
    if command -v timeout >/dev/null 2>&1; then
      echo '{"command":["quit"]}' | timeout 1s socat - "$SOCKET" >/dev/null 2>&1 || true
    else
      echo '{"command":["quit"]}' | socat - "$SOCKET" >/dev/null 2>&1 || true
    fi
    sleep 0.2
  fi

  if [[ -n "$tracked_pid" ]] \
    && kill -0 "$tracked_pid" 2>/dev/null \
    && tracked_pid_is_mango_mpv "$tracked_pid"; then
    # Standalone launches use setsid (PGID == PID); Node-scoped launches keep
    # mpv in the wrapper group (PGID != PID). Signal exactly the owned scope.
    signal_tracked_mpv "$tracked_pid" TERM
    sleep 0.2
    if kill -0 "$tracked_pid" 2>/dev/null; then
      signal_tracked_mpv "$tracked_pid" KILL
    fi
  fi
  stop_playback_osd
  rm -f "$MPV_PID_FILE" "$SOCKET" \
    "$LEGACY_VLC_PID_FILE" "$LEGACY_PLAYER_STATE" "$LEGACY_VLC_PLAYLIST" \
    "$PLAYBACK_DISPLAY_MATCHED_FILE"
}

if [[ "${MANGO_MPV_STOP_NO_DISPLAY:-0}" != "1" ]]; then
  # Black-screen-first restore: hide desktop chrome + paint root black BEFORE
  # tearing down mpv, so the instant mpv unmaps the exposed surface is pure
  # black (no lxpanel/wallpaper flash). Then browse HDMI → reveal launcher.
  bash "$REPO_DIR/scripts/lib/mango-desktop.sh" hide 2>/dev/null || true
  teardown_mpv
  rm -f "$PLAYBACK_ACTIVE_FILE"
  MANGO_MPV_STOP_HOME="$GO_HOME" bash "$RESTORE_SH" finish
else
  teardown_mpv
fi

exit 0
