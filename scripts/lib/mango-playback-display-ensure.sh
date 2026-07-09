#!/usr/bin/env bash
# Operator/debug only: re-apply source-matched display mode during playback.
# Couch path must NOT call this — HDMI matching is owned by mpv-play start/stop.
# Enable explicitly: MANGO_PLAYBACK_DISPLAY_ENSURE=1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
# shellcheck source=mango-playback-env.sh
source "$SCRIPT_DIR/mango-playback-env.sh"

if [[ "${MANGO_PLAYBACK_DISPLAY_ENSURE:-0}" != "1" ]]; then
  exit 0
fi

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
MPV_IPC_SH="${MANGO_MPV_IPC_SH:-$REPO_DIR/scripts/m2-catalog/service/mpv-ipc.sh}"
DISPLAY_MODE_SH="$SCRIPT_DIR/mango-display-mode.sh"

mpv_ipc_property() {
  local name="$1"
  [[ -x "$MPV_IPC_SH" && -S "$SOCKET" ]] || return 1
  local reply
  reply="$("$MPV_IPC_SH" get_property "$name" 2>/dev/null || true)"
  [[ -n "$reply" ]] || return 1
  python3 -c 'import json,sys; print(json.load(sys.stdin).get("data",""))' <<<"$reply" 2>/dev/null
}

mpv_playback_active() {
  [[ -f "${MANGO_PLAYBACK_ACTIVE_FILE:-${HOME}/.cache/mango/playback-active}" ]] && return 0
  [[ -S "$SOCKET" ]] || return 1
  pgrep -x mpv >/dev/null 2>&1
}

current_output_width() {
  bash "$DISPLAY_MODE_SH" status 2>/dev/null | awk '{split($2, mode, "@"); split(mode[1], dims, "x"); print dims[1]}'
}

raise_mpv_window() {
  command -v xdotool >/dev/null 2>&1 || return 0
  command -v socat >/dev/null 2>&1 || return 0
  [[ -S "$SOCKET" ]] || return 0
  local wid
  wid="$(mpv_ipc_property wid 2>/dev/null || true)"
  [[ -n "$wid" && "$wid" != "0" ]] || return 0
  xdotool windowmap --sync "$wid" 2>/dev/null || true
  xdotool windowraise "$wid" 2>/dev/null || true
  printf '%s\n' '{"command":["set_property","fullscreen",true]}' | socat - "$SOCKET" >/dev/null 2>&1 || true
}

ensure_playback_display() {
  mpv_playback_active || return 0

  local width height fps profile output_width needs_4k=0
  width="$(mpv_ipc_property width 2>/dev/null || true)"
  height="$(mpv_ipc_property height 2>/dev/null || true)"
  fps="$(mpv_ipc_property container-fps 2>/dev/null || true)"
  if [[ -z "$fps" || "$fps" == "0" || "$fps" == "0.0" ]]; then
    fps="$(mpv_ipc_property estimated-vf-fps 2>/dev/null || true)"
  fi

  profile="$(python3 - "$width" "$height" "$fps" <<'PY' || true
import sys
try:
    w = int(float(sys.argv[1] or 0))
    h = int(float(sys.argv[2] or 0))
    fps = float(sys.argv[3] or 0)
except ValueError:
    raise SystemExit(1)
if w <= 0 or h <= 0 or fps <= 0:
    raise SystemExit(1)
print(f"{w} {h} {fps:.3f}")
PY
)"
  [[ -n "$profile" ]] || return 0
  read -r width height fps <<<"$profile"

  if [[ "$width" -ge 3000 || "$height" -ge 1600 ]]; then
    needs_4k=1
  fi

  output_width="$(current_output_width 2>/dev/null || true)"

  if [[ "$needs_4k" == "1" ]]; then
    if [[ -n "$output_width" && "$output_width" =~ ^[0-9]+$ && "$output_width" -lt 3000 ]]; then
      bash "$DISPLAY_MODE_SH" playback-auto "$width" "$height" "$fps" 2>/dev/null || true
      raise_mpv_window
      return 0
    fi
    if [[ -n "$output_width" && "$output_width" =~ ^[0-9]+$ && "$output_width" -ge 3000 ]]; then
      raise_mpv_window
    fi
    return 0
  fi

  if [[ -n "$output_width" && "$output_width" =~ ^[0-9]+$ && "$output_width" -ge 3000 ]]; then
    bash "$DISPLAY_MODE_SH" playback-auto "$width" "$height" "$fps" 2>/dev/null || true
    raise_mpv_window
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  ensure_playback_display
fi
