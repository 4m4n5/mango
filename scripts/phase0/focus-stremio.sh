#!/usr/bin/env bash
# Focus the main Stremio window and click the webview.
# Run on the Pi: bash scripts/phase0/focus-stremio.sh

set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

is_main_stremio_window() {
  local name=$1
  [[ -z "$name" ]] && return 1
  [[ "$name" == *"Selection Owner"* ]] && return 1
  [[ "$name" == *"tooltip"* ]] && return 1
  [[ "$name" =~ ^[Ss]tremio$ ]] && return 0
  [[ "$name" == *"Stremio"* ]] && return 0
  return 1
}

find_stremio_wid() {
  local wid name width height area best_wid="" best_area=0

  if ! command -v xdotool &>/dev/null; then
    return 1
  fi

  # Prefer exact title "Stremio"
  for wid in $(xdotool search --name Stremio 2>/dev/null); do
    name=$(xdotool getwindowname "$wid" 2>/dev/null || true)
    if [[ "$name" == "Stremio" ]]; then
      echo "$wid"
      return 0
    fi
  done

  # Largest Stremio-related window (skip Qt helper windows)
  for wid in $(xdotool search --name Stremio 2>/dev/null); do
    name=$(xdotool getwindowname "$wid" 2>/dev/null || true)
    is_main_stremio_window "$name" || continue
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

  for wid in $(xdotool search --class stremio 2>/dev/null); do
    name=$(xdotool getwindowname "$wid" 2>/dev/null || true)
    is_main_stremio_window "$name" || continue
    echo "$wid"
    return 0
  done

  return 1
}

present_stremio_window() {
  local wid=$1
  local screen_w=1920 screen_h=1080

  if command -v xdotool &>/dev/null; then
    read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")
  fi

  # Size for TV. Avoid wmctrl fullscreen — it can crash Qt Stremio on Pi.
  if command -v wmctrl &>/dev/null; then
    wmctrl -i -r "$wid" -e "0,0,0,${screen_w},${screen_h}" 2>/dev/null || true
    wmctrl -i -r "$wid" -b add,maximized_vert,maximized_horz 2>/dev/null \
      || wmctrl -r Stremio -b add,maximized_vert,maximized_horz 2>/dev/null \
      || true
  fi

  xdotool windowactivate --sync "$wid" 2>/dev/null || true
}

WID=$(find_stremio_wid) || WID=""

if [[ -z "$WID" ]]; then
  echo "! Stremio main window not found"
  echo "Open windows:"
  wmctrl -l 2>/dev/null || xdotool search --name Stremio 2>/dev/null | while read -r w; do
    echo "  $w $(xdotool getwindowname "$w" 2>/dev/null)"
  done
  exit 1
fi

xdotool windowactivate --sync "$WID" 2>/dev/null || true
sleep 0.2

eval "$(xdotool getwindowgeometry --shell "$WID" 2>/dev/null)" || WIDTH=800 HEIGHT=600
CX=$((WIDTH / 2))
CY=$((HEIGHT / 2))
xdotool mousemove --window "$WID" "$CX" "$CY" 2>/dev/null || true
xdotool click 1 2>/dev/null || true
sleep 0.1

present_stremio_window "$WID"

NAME=$(xdotool getwindowname "$WID" 2>/dev/null || echo "?")
echo "✓ Stremio focused (wid=$WID name=$NAME) — TV presentation applied"
