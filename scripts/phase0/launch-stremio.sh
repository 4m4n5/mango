#!/usr/bin/env bash
# Launch Stremio with xdotool gamepad bridge (not input-remapper).
# Run on the Pi: bash scripts/phase0/launch-stremio.sh
# Clean restart: bash scripts/phase0/reset-stremio.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BT_MAC="E4:17:D8:EB:00:44"
LOG="${TMPDIR:-/tmp}/mango-stremio.log"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

bluetoothctl connect "$BT_MAC" 2>/dev/null || true
sleep 2

killall kodi kodi.bin 2>/dev/null || true
bash "$SCRIPT_DIR/kill-stremio.sh" || true
bash "$SCRIPT_DIR/stop-stremio-pad-bridge.sh" 2>/dev/null || true

if ! command -v stremio &>/dev/null; then
  echo "! stremio not in PATH — bash scripts/phase0/install-stremio.sh"
  exit 1
fi

echo "Starting Stremio — D-pad = move, B = select, Y = back"
echo "Using xdotool pad bridge (Stremio ignores input-remapper)"
nohup stremio >"$LOG" 2>&1 &
STREMIO_PID=$!
echo "Stremio pid: $STREMIO_PID"
sleep 6

if ! kill -0 "$STREMIO_PID" 2>/dev/null; then
  echo "! Stremio exited. Log:"
  tail -20 "$LOG" 2>/dev/null || true
  exit 1
fi

bash "$SCRIPT_DIR/start-stremio-pad-bridge.sh"

focused=false
for _ in $(seq 1 30); do
  if bash "$SCRIPT_DIR/focus-stremio.sh" 2>/dev/null; then
    focused=true
    break
  fi
  sleep 1
done

if $focused; then
  echo "✓ Stremio ready — try D-pad / B / Y (only while Stremio is focused)"
else
  echo "! Click Stremio on the TV, then: bash scripts/phase0/focus-stremio.sh"
fi

echo "Log: $LOG"
