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
    eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || continue
    area=$((WIDTH * HEIGHT))
    if (( area > best_area )); then
      best_area=$area
      best_wid=$wid
    fi
  done
  [[ -n "$best_wid" ]] && echo "$best_wid"
}

present_stremio_tv() {
  local wid=$1
  local screen_w screen_h

  read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")

  xdotool windowactivate "$wid" 2>/dev/null || true
  xdotool windowmove "$wid" 0 0 2>/dev/null || true
  xdotool windowsize "$wid" "$screen_w" "$screen_h" 2>/dev/null || true

  if command -v wmctrl &>/dev/null; then
    wmctrl -i -r "$wid" -e "0,0,0,${screen_w},${screen_h}" 2>/dev/null || true
    wmctrl -i -r "$wid" -b add,maximized_vert,maximized_horz,fullscreen 2>/dev/null || true
  fi

  local attempt
  for attempt in $(seq 1 8); do
    xdotool windowsize "$wid" "$screen_w" "$screen_h" 2>/dev/null || true
    eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || break
    if (( WIDTH >= screen_w - 80 && HEIGHT >= screen_h - 80 )); then
      return 0
    fi
    sleep 0.15
  done
  return 1
}

stremio_is_tv_sized() {
  local wid=$1 screen_w screen_h
  read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")
  eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || return 1
  (( WIDTH >= screen_w - 80 && HEIGHT >= screen_h - 80 ))
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  WID=$(find_main_stremio_wid) || exit 1
  present_stremio_tv "$WID"
  bash "$SCRIPT_DIR/../lib/mango-desktop.sh" hide 2>/dev/null || true
  bash "$SCRIPT_DIR/../lib/mango-cursor.sh" hide 2>/dev/null || true
  xdotool getwindowgeometry "$WID"
fi
