#!/usr/bin/env bash
# Launch Stremio with D-pad → keyboard remapping (8BitDo Micro).
# Run on the Pi: bash scripts/phase0/launch-stremio.sh
# Clean restart: bash scripts/phase0/reset-stremio.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BT_MAC="E4:17:D8:EB:00:44"
LOG="${TMPDIR:-/tmp}/mango-stremio.log"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if [[ ! -f "$HOME/.Xauthority" ]]; then
  echo "! Missing $HOME/.Xauthority — launch Stremio from the Pi desktop once, or run: startx"
fi

bluetoothctl connect "$BT_MAC" 2>/dev/null || true
sleep 2

killall kodi kodi.bin 2>/dev/null || true
bash "$SCRIPT_DIR/kill-stremio.sh" || true

bash "$SCRIPT_DIR/map-pro-controller.sh"

if ! command -v stremio &>/dev/null; then
  echo "! stremio not in PATH — bash scripts/phase0/install-stremio.sh"
  exit 1
fi

echo "Starting Stremio — D-pad = move, B = select, Y = back"
echo "Log: $LOG"
nohup stremio >"$LOG" 2>&1 &
STREMIO_PID=$!
echo "Stremio pid: $STREMIO_PID"

sleep 5

if ! kill -0 "$STREMIO_PID" 2>/dev/null; then
  echo "! Stremio exited immediately. Last log lines:"
  tail -20 "$LOG" 2>/dev/null || true
  exit 1
fi

echo "Waiting for Stremio window (up to 60s)..."
focused=false
for _ in $(seq 1 60); do
  if bash "$SCRIPT_DIR/focus-stremio.sh" 2>/dev/null; then
    focused=true
    break
  fi
  sleep 1
done

if $focused; then
  echo "✓ Stremio running and focused — try the controller"
  echo "  Debug: bash scripts/phase0/test-stremio-input.sh"
else
  echo "! Stremio running (pid $STREMIO_PID) but window not focused"
  echo "  Click Stremio on the TV, then: bash scripts/phase0/focus-stremio.sh"
  echo "  Log: tail -f $LOG"
  wmctrl -l 2>/dev/null || true
fi
