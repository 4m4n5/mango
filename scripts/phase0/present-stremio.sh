#!/usr/bin/env bash
# Size Stremio for TV (Openbox rules alone are not enough for Qt on Pi).

set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

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
  local screen_w screen_h panel_h=0 target_h

  read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")
  if xdotool search --name "panel" 2>/dev/null | grep -q .; then
    panel_h=92
  fi
  target_h=$((screen_h - panel_h))

  xdotool windowactivate --sync "$wid" 2>/dev/null || true
  xdotool windowmove --sync "$wid" 0 "$panel_h" 2>/dev/null || true
  xdotool windowsize --sync "$wid" "$screen_w" "$target_h" 2>/dev/null || true

  if command -v wmctrl &>/dev/null; then
    wmctrl -i -r "$wid" -e "0,0,${panel_h},${screen_w},${target_h}" 2>/dev/null || true
    wmctrl -i -r "$wid" -b add,maximized_vert,maximized_horz 2>/dev/null || true
  fi

  # Qt Stremio often ignores the first resize — retry briefly.
  local attempt
  for attempt in $(seq 1 8); do
    xdotool windowsize --sync "$wid" "$screen_w" "$target_h" 2>/dev/null || true
    eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || break
    if (( WIDTH >= screen_w - 80 && HEIGHT >= target_h - 80 )); then
      return 0
    fi
    sleep 0.4
  done
  return 1
}

stremio_is_tv_sized() {
  local wid=$1 screen_w screen_h panel_h=0 target_h
  read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")
  if xdotool search --name "panel" 2>/dev/null | grep -q .; then
    panel_h=92
  fi
  target_h=$((screen_h - panel_h))
  eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || return 1
  (( WIDTH >= screen_w - 80 && HEIGHT >= target_h - 80 ))
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  WID=$(find_main_stremio_wid) || exit 1
  present_stremio_tv "$WID"
  xdotool getwindowgeometry "$WID"
fi
