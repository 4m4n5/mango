#!/usr/bin/env bash
# Launch Kodi with D-pad → keyboard remapping (8BitDo Micro).
# Run on the Pi: bash scripts/phase0/launch-kodi.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/connect-gamepad.sh"

killall kodi kodi.bin 2>/dev/null || true
sleep 0.5

bash "$SCRIPT_DIR/stop-stremio-pad-bridge.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/map-pro-controller.sh"
bash "$SCRIPT_DIR/kodi-keyboard-only.sh" 2>/dev/null || true

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

echo "Starting Kodi — D-pad = move, B = select, Y = back"
kodi &
