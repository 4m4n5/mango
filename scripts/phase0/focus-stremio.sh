#!/usr/bin/env bash
# Focus Stremio and click the webview so keyboard/gamepad input lands.
# Run on the Pi: bash scripts/phase0/focus-stremio.sh

set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

find_stremio_wid() {
  local wid
  if ! command -v xdotool &>/dev/null; then
    return 1
  fi
  wid=$(xdotool search --name Stremio 2>/dev/null | head -1 || true)
  [[ -n "$wid" ]] && echo "$wid" && return 0
  wid=$(xdotool search --class stremio 2>/dev/null | head -1 || true)
  [[ -n "$wid" ]] && echo "$wid" && return 0
  return 1
}

WID=$(find_stremio_wid) || WID=""

if [[ -z "$WID" ]]; then
  if command -v wmctrl &>/dev/null && wmctrl -l 2>/dev/null | grep -qi stremio; then
    wmctrl -a Stremio 2>/dev/null || true
    sleep 0.5
    WID=$(find_stremio_wid) || WID=""
  fi
fi

if [[ -z "$WID" ]]; then
  echo "! Stremio window not found"
  wmctrl -l 2>/dev/null || true
  exit 1
fi

xdotool windowactivate --sync "$WID"
sleep 0.3

# Click centre — Qt WebEngine often ignores keys until the webview is clicked
eval "$(xdotool getwindowgeometry --shell "$WID")"
CX=$((WIDTH / 2))
CY=$((HEIGHT / 2))
xdotool mousemove --window "$WID" "$CX" "$CY"
xdotool click 1
sleep 0.2

NAME=$(xdotool getwindowname "$WID" 2>/dev/null || echo "?")
echo "✓ Stremio focused (wid=$WID name=$NAME) — clicked centre"
