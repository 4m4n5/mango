#!/usr/bin/env bash
# Launch Stremio with D-pad → keyboard remapping (8BitDo Micro).
# Run on the Pi: bash scripts/phase0/launch-stremio.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BT_MAC="E4:17:D8:EB:00:44"

bluetoothctl connect "$BT_MAC" 2>/dev/null || true
sleep 2

# Kill stale Stremio / server (fixes EADDRINUSE on port 11470)
pkill -f 'stremio-server|/opt/stremio/server' 2>/dev/null || true
killall stremio 2>/dev/null || true
sleep 2

bash "$SCRIPT_DIR/map-pro-controller.sh"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

echo "Starting Stremio — D-pad = move, A = select, B = back"
stremio &
