#!/usr/bin/env bash
# Route 8BitDo Micro -> xdotool while Stremio is open (not input-remapper).
# Run on the Pi: bash scripts/phase0/start-stremio-pad-bridge.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/irctl.sh
source "$SCRIPT_DIR/lib/irctl.sh"
# shellcheck source=lib/gamepad-js.sh
source "$SCRIPT_DIR/lib/gamepad-js.sh"

CACHE_DIR="${HOME}/.cache/mango"
PIDFILE="${CACHE_DIR}/stremio-pad-bridge.pid"
LOG="/tmp/mango-stremio-pad-bridge.log"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

mkdir -p "$CACHE_DIR"

if pgrep -f stremio-pad-bridge.py >/dev/null 2>&1; then
  echo "✓ Pad bridge already running"
  exit 0
fi

if ! python3 -c "import evdev" 2>/dev/null; then
  echo "Installing python3-evdev..."
  sudo apt install -y python3-evdev
fi

ir_stop_service
hide_pro_controller_js

bash "$SCRIPT_DIR/stop-stremio-pad-bridge.sh" 2>/dev/null || true
sleep 0.5

echo "Starting stremio-pad-bridge (needs sudo to read /dev/input)..."
BRIDGE_OK=false
for attempt in 1 2 3 4 5; do
  sudo -E DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" HOME="$HOME" SUDO_USER="${USER}" \
    python3 "$SCRIPT_DIR/stremio-pad-bridge.py" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 0.8
  if pgrep -f stremio-pad-bridge.py >/dev/null 2>&1; then
    BRIDGE_OK=true
    break
  fi
  irctl_quick --command stop --device "Pro Controller" 2>/dev/null || true
  sleep 0.5
done

if $BRIDGE_OK; then
  echo "✓ Pad bridge running — log: $LOG"
else
  echo "! Bridge failed to grab pad — keeping input-remapper for Stremio"
  tail -8 "$LOG" 2>/dev/null || true
  ir_start_with_autoload "Pro Controller" "mango-tv"
  exit 1
fi
