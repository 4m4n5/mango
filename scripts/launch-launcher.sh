#!/usr/bin/env bash
# Return focus to the Chromium launcher without killing the kiosk.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export DISPLAY=":0"
export XAUTHORITY="/home/aman/.Xauthority"
export HOME="/home/aman"

bash "$REPO_DIR/scripts/lib/mango-window.sh" show

bash "$REPO_DIR/scripts/phase0/stop-stremio-pad-bridge.sh" 2>/dev/null || true
bash "$REPO_DIR/scripts/phase0/map-pro-controller.sh"

if command -v wmctrl >/dev/null 2>&1; then
  wmctrl -r Stremio -b add,hidden 2>/dev/null || true
  wmctrl -r Kodi -b add,hidden 2>/dev/null || true
fi

if command -v xdotool >/dev/null 2>&1; then
  xdotool search --class mango-launcher windowactivate --sync 2>/dev/null \
    || xdotool search --class chromium windowactivate --sync 2>/dev/null \
    || true
fi

echo "Launcher focus requested"
