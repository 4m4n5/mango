#!/usr/bin/env bash
# Size Kodi for TV fullscreen.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

bash "$SCRIPT_DIR/../lib/mango-desktop.sh" hide 2>/dev/null || true

find_main_kodi_wid() {
  local wid name best_wid="" best_area=0 area
  command -v xdotool &>/dev/null || return 1
  for wid in $(xdotool search --class Kodi 2>/dev/null); do
    name=$(xdotool getwindowname "$wid" 2>/dev/null || true)
    [[ "$name" == *"Kodi"* ]] || continue
    eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || continue
    area=$((WIDTH * HEIGHT))
    if (( area > best_area )); then
      best_area=$area
      best_wid=$wid
    fi
  done
  if [[ -n "$best_wid" ]]; then
    echo "$best_wid"
    return 0
  fi
  xdotool search --name Kodi 2>/dev/null | head -1
}

present_kodi_tv() {
  local wid=$1 screen_w screen_h

  command -v xdotool &>/dev/null || return 1
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
  for attempt in 1 2 3; do
    xdotool windowsize "$wid" "$screen_w" "$screen_h" 2>/dev/null || true
    eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || break
    if (( WIDTH >= screen_w - 80 && HEIGHT >= screen_h - 80 )); then
      return 0
    fi
    sleep 0.08
  done
  return 1
}

kodi_is_tv_sized() {
  local wid=$1 screen_w screen_h
  read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")
  eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || return 1
  (( WIDTH >= screen_w - 80 && HEIGHT >= screen_h - 80 ))
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  WID=$(find_main_kodi_wid) || exit 1
  present_kodi_tv "$WID"
  xdotool getwindowgeometry "$WID"
fi
