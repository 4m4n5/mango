#!/usr/bin/env bash
# Launch Stremio with D-pad → keyboard remapping (8BitDo Micro).
# Run on the Pi: bash scripts/phase0/launch-stremio.sh
# Clean restart: bash scripts/phase0/reset-stremio.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BT_MAC="E4:17:D8:EB:00:44"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

bluetoothctl connect "$BT_MAC" 2>/dev/null || true
sleep 2

killall kodi kodi.bin 2>/dev/null || true
bash "$SCRIPT_DIR/kill-stremio.sh" || true

bash "$SCRIPT_DIR/map-pro-controller.sh"

echo "Starting Stremio — D-pad = move, B = select, Y = back"
stremio &

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
  echo "✓ Stremio focused — try the controller"
  echo "  Debug: bash scripts/phase0/test-stremio-input.sh"
else
  echo "! Click the Stremio window on the TV, then:"
  echo "  bash scripts/phase0/focus-stremio.sh"
  echo "  bash scripts/phase0/test-stremio-input.sh"
fi
