#!/usr/bin/env bash
# Size Stremio for TV (Openbox rules alone are not enough for Qt on Pi).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

bash "$SCRIPT_DIR/../lib/mango-desktop.sh" hide 2>/dev/null || true

find_main_stremio_wid() {
  local wid name best_wid="" best_area=0 area
  command -v xdotool &>/dev/null || return 1
  for wid in $(xdotool search --class Stremio 2>/dev/null); do
    name=$(xdotool getwindowname "$wid" 2>/dev/null || true)
    [[ "$name" == *"Stremio"* ]] || continue
    [[ "$name" == *"Selection Owner"* ]] && continue
    if eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)"; then
      area=$((WIDTH * HEIGHT))
    else
      # Hidden/unmapped after hide-media — still the main window.
      area=2073600
    fi
    if (( area > best_area )); then
      best_area=$area
      best_wid=$wid
    fi
  done
  [[ -n "$best_wid" ]] && echo "$best_wid"
}

stremio_is_tv_sized() {
  local wid=$1 screen_w screen_h
  read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")
  eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || return 1
  (( WIDTH >= screen_w - 80 && HEIGHT >= screen_h - 80 ))
}

# Undo hide-media.sh (unmap / off-screen / below).
reveal_stremio_window() {
  local wid=$1

  xdotool windowmap "$wid" 2>/dev/null || true
  if command -v wmctrl &>/dev/null; then
    wmctrl -i -r "$wid" -b remove,hidden,below 2>/dev/null || true
  fi
  xdotool windowmove "$wid" 0 0 2>/dev/null || true
}

# Focus only — no resize (safe when already fullscreen).
present_stremio_tv_quick() {
  local wid=$1

  reveal_stremio_window "$wid"
  xdotool windowactivate "$wid" 2>/dev/null || true
  if command -v wmctrl &>/dev/null; then
    wmctrl -i -r "$wid" -b add,above,fullscreen 2>/dev/null || true
  fi
  xdotool windowraise "$wid" 2>/dev/null || true
}

# Full TV present — wmctrl/xdotool only (never F11; it toggles and causes jitter).
present_stremio_tv() {
  local wid=$1
  local screen_w screen_h

  reveal_stremio_window "$wid"
  read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")

  xdotool windowactivate "$wid" 2>/dev/null || true
  xdotool windowmove "$wid" 0 0 2>/dev/null || true
  xdotool windowsize "$wid" "$screen_w" "$screen_h" 2>/dev/null || true

  if command -v wmctrl &>/dev/null; then
    wmctrl -i -r "$wid" -e "0,0,0,${screen_w},${screen_h}" 2>/dev/null || true
    wmctrl -i -r "$wid" -b add,maximized_vert,maximized_horz,fullscreen,above 2>/dev/null || true
  fi

  xdotool windowraise "$wid" 2>/dev/null || true

  local attempt
  for attempt in $(seq 1 8); do
    xdotool windowsize "$wid" "$screen_w" "$screen_h" 2>/dev/null || true
    eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || break
    if (( WIDTH >= screen_w - 80 && HEIGHT >= screen_h - 80 )); then
      return 0
    fi
    sleep 0.12
  done
  return 1
}

# After Y-back: only repair layout if Escape left Stremio windowed (white-screen fix).
present_stremio_after_back() {
  sleep 0.45
  local wid
  wid=$(find_main_stremio_wid) || return 0
  if stremio_is_tv_sized "$wid"; then
    return 0
  fi
  present_stremio_tv "$wid" || true
  bash "$SCRIPT_DIR/../lib/mango-cursor.sh" hide 2>/dev/null || true
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  MODE="${1:-}"
  case "$MODE" in
    --after-back)
      present_stremio_after_back
      exit 0
      ;;
    --quick)
      WID=$(find_main_stremio_wid) || exit 1
      if stremio_is_tv_sized "$WID"; then
        present_stremio_tv_quick "$WID"
        exit 0
      fi
      present_stremio_tv "$WID"
      ;;
    "")
      WID=$(find_main_stremio_wid) || exit 1
      if stremio_is_tv_sized "$WID"; then
        present_stremio_tv_quick "$WID"
      else
        present_stremio_tv "$WID"
      fi
      ;;
    *)
      echo "usage: $0 [--quick | --after-back]" >&2
      exit 2
      ;;
  esac
  bash "$SCRIPT_DIR/../lib/mango-desktop.sh" hide 2>/dev/null || true
  bash "$SCRIPT_DIR/../lib/mango-cursor.sh" hide 2>/dev/null || true
  xdotool getwindowgeometry "$WID" 2>/dev/null || true
fi
