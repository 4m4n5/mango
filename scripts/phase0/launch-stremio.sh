#!/usr/bin/env bash
# Launch Stremio with D-pad → keyboard remapping (8BitDo Micro).
# Run on the Pi: bash scripts/phase0/launch-stremio.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BT_MAC="E4:17:D8:EB:00:44"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

bluetoothctl connect "$BT_MAC" 2>/dev/null || true
sleep 2

# Only one TV app at a time — Kodi grabs focus / confuses input
killall kodi kodi.bin 2>/dev/null || true

# Kill stale Stremio / server (fixes EADDRINUSE on port 11470)
pkill -f 'stremio-server|/opt/stremio/server' 2>/dev/null || true
killall stremio 2>/dev/null || true
sleep 2

bash "$SCRIPT_DIR/map-pro-controller.sh"

echo "Starting Stremio — D-pad = move, B = select, Y = back"
stremio &

# input-remapper injects keys to the focused X11 window — focus Stremio after it opens
echo "Waiting for Stremio window..."
focused=false
for _ in $(seq 1 45); do
  if bash "$SCRIPT_DIR/focus-stremio.sh" 2>/dev/null; then
    focused=true
    break
  fi
  sleep 1
done

if $focused; then
  echo "Controller should work now. If not, run: bash scripts/phase0/focus-stremio.sh"
else
  echo "! Auto-focus failed — click the Stremio window on the TV once, then try the controller"
  echo "  Or run: bash scripts/phase0/focus-stremio.sh"
fi
