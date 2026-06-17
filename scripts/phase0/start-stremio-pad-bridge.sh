#!/usr/bin/env bash
# Route 8BitDo Micro -> xdotool while Stremio is open (not input-remapper).
# Run on the Pi: bash scripts/phase0/start-stremio-pad-bridge.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="/tmp/mango-stremio-pad-bridge.pid"
LOG="/tmp/mango-stremio-pad-bridge.log"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if ! python3 -c "import evdev" 2>/dev/null; then
  echo "Installing python3-evdev..."
  sudo apt install -y python3-evdev
fi

# Remapper grabs the pad — stop it so the bridge can read events
sudo systemctl stop input-remapper 2>/dev/null || true
input-remapper-control --command stop --device "Pro Controller" 2>/dev/null || true
input-remapper-control --command stop --device "Pro Controller (IMU)" 2>/dev/null || true

if [[ -f "$PIDFILE" ]]; then
  old=$(cat "$PIDFILE")
  kill "$old" 2>/dev/null || true
  rm -f "$PIDFILE"
fi

echo "Starting stremio-pad-bridge (needs sudo to read /dev/input)..."
sudo -E DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" HOME="$HOME" \
  python3 "$SCRIPT_DIR/stremio-pad-bridge.py" >>"$LOG" 2>&1 &
echo $! | sudo tee "$PIDFILE" >/dev/null
sleep 1

if sudo kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "✓ Pad bridge running (pid $(cat "$PIDFILE")) — log: $LOG"
else
  echo "! Bridge failed to start:"
  tail -10 "$LOG" 2>/dev/null || true
  exit 1
fi
