#!/usr/bin/env bash
# Launch Kodi with stick→keyboard remapping (works for Kodi + Stremio UIs).
# Run on the Pi: bash scripts/phase0/launch-kodi.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BT_MAC="E4:17:D8:EB:00:44"

bluetoothctl connect "$BT_MAC" 2>/dev/null || true
sleep 2

killall kodi kodi.bin 2>/dev/null || true
sleep 1

bash "$SCRIPT_DIR/map-pro-controller-sticks.sh"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

echo "Starting Kodi — use LEFT STICK to move, A=select, B=back"
kodi &
