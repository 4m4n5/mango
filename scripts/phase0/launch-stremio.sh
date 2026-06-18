#!/usr/bin/env bash
# Launch Stremio with xdotool gamepad bridge (not input-remapper).
# Run on the Pi: bash scripts/phase0/launch-stremio.sh
# Clean restart: bash scripts/phase0/reset-stremio.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="${TMPDIR:-/tmp}/mango-stremio.log"

# shellcheck source=lib/stremio-ports.sh
source "$SCRIPT_DIR/lib/stremio-ports.sh"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

bash "$SCRIPT_DIR/connect-gamepad.sh"

killall kodi kodi.bin 2>/dev/null || true

if stremio_process_running; then
  bash "$SCRIPT_DIR/kill-stremio.sh" || true
fi

stremio_ports_free || {
  echo "! Stremio ports still busy — run: bash scripts/phase0/kill-stremio.sh"
  exit 1
}

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

ready=false
for _ in $(seq 1 30); do
  if ! kill -0 "$STREMIO_PID" 2>/dev/null; then
    echo "! Stremio exited. Log:"
    tail -20 "$LOG" 2>/dev/null || true
    exit 1
  fi
  if command -v xdotool &>/dev/null; then
    for wid in $(xdotool search --name Stremio 2>/dev/null); do
      name=$(xdotool getwindowname "$wid" 2>/dev/null || true)
      if [[ "$name" == "Stremio" ]]; then
        ready=true
        break 2
      fi
    done
  fi
  sleep 0.2
done

if ! $ready; then
  echo "! Stremio window not detected yet — continuing focus loop"
fi

bash "$SCRIPT_DIR/start-stremio-pad-bridge.sh" || {
  echo "! Pad bridge failed — Stremio may still open; check /tmp/mango-stremio-pad-bridge.log"
}

focused=false
for _ in $(seq 1 20); do
  if bash "$SCRIPT_DIR/focus-stremio.sh" 2>/dev/null; then
    focused=true
    break
  fi
  sleep 0.15
done

if $focused; then
  echo "✓ Stremio ready — D-pad / B select / Y back / ⌂ home"
else
  echo "! Click Stremio on the TV, then: bash scripts/phase0/focus-stremio.sh"
fi

echo "Log: $LOG"
