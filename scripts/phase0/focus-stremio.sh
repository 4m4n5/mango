#!/usr/bin/env bash
# Focus the main Stremio window, present TV size, click webview.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=present-stremio.sh
source "$SCRIPT_DIR/present-stremio.sh"

WID=$(find_main_stremio_wid) || {
  echo "! Stremio main window not found"
  wmctrl -l 2>/dev/null || true
  exit 1
}

present_stremio_tv "$WID" || true

xdotool windowactivate --sync "$WID" 2>/dev/null || true
eval "$(xdotool getwindowgeometry --shell "$WID" 2>/dev/null)" || WIDTH=800 HEIGHT=600
CX=$((WIDTH / 2))
CY=$((HEIGHT / 2))
xdotool mousemove --window "$WID" "$CX" "$CY" 2>/dev/null || true
xdotool click 1 2>/dev/null || true

NAME=$(xdotool getwindowname "$WID" 2>/dev/null || echo "?")
echo "✓ Stremio focused (wid=$WID name=$NAME)"

if stremio_is_tv_sized "$WID"; then
  echo "✓ Stremio TV-sized"
  exit 0
fi

echo "! Stremio not full screen yet"
exit 1
