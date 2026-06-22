#!/usr/bin/env bash
# Single pad owner for mango TV — Stremio, Kodi, launcher. Stops input-remapper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/irctl.sh
source "$SCRIPT_DIR/lib/irctl.sh"
# shellcheck source=lib/gamepad-js.sh
source "$SCRIPT_DIR/lib/gamepad-js.sh"

CACHE_DIR="${HOME}/.cache/mango"
PIDFILE="${CACHE_DIR}/mango-tv-pad.pid"
LOG="/tmp/mango-tv-pad.log"
PAD_PY="$SCRIPT_DIR/mango-tv-pad.py"
PAD_RUN="$SCRIPT_DIR/run-mango-tv-pad.sh"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

mkdir -p "$CACHE_DIR"

pad_running() {
  if pgrep -f '[m]ango-tv-pad\.py' >/dev/null 2>&1; then
    return 0
  fi
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid=$(cat "$PIDFILE")
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$PIDFILE"
  fi
  return 1
}

pro_controller_present() {
  python3 - <<'PY'
import evdev
for path in evdev.list_devices():
    if evdev.InputDevice(path).name == "Pro Controller":
        raise SystemExit(0)
raise SystemExit(1)
PY
}

ensure_sudo() {
  if sudo -n true 2>/dev/null; then
    return 0
  fi
  if [[ -t 0 ]]; then
    echo "One sudo password for pad grab (won't ask again this session)..."
    sudo -v
    return 0
  fi
  echo "! Need sudo for evdev grab. On the Pi run:" >&2
  echo "  sudo bash ~/mango/scripts/m1-foundation/pad/install-pad-sudoers.sh" >&2
  echo "  — or SSH interactively and run this script again" >&2
  return 1
}

if pad_running; then
  if [[ "${MANGO_PAD_DEBUG:-}" != "1" ]]; then
    echo "✓ mango TV pad already running"
    exit 0
  fi
  echo "Restarting pad for debug session..."
  pkill -f '[m]ango-tv-pad\.py' 2>/dev/null || true
  sudo -n pkill -f '[m]ango-tv-pad\.py' 2>/dev/null || sudo pkill -f '[m]ango-tv-pad\.py' 2>/dev/null || true
  rm -f "$PIDFILE"
  sleep 0.3
fi

if ! python3 -c "import evdev" 2>/dev/null; then
  echo "Installing python3-evdev..."
  sudo apt install -y python3-evdev
fi

echo "=== Bluetooth: Pro Controller ==="
BT_ALREADY=false
if bluetoothctl info "E4:17:D8:EB:00:44" 2>/dev/null | grep -q "Connected: yes"; then
  BT_ALREADY=true
fi
bash "$SCRIPT_DIR/connect-gamepad.sh" || true
if ! $BT_ALREADY; then
  sleep 1
fi

if ! pro_controller_present; then
  if [[ "${MANGO_PAD_WAIT_BT:-1}" != "1" ]]; then
    echo "! Pro Controller not found — wake the pad and connect Bluetooth first:"
    echo "  bash ~/mango/scripts/m1-foundation/pad/gamepad-fresh-start.sh"
    echo ""
    echo "  Quick: press any button on the Micro, then:"
    echo "  bluetoothctl connect E4:17:D8:EB:00:44"
    exit 1
  fi
  echo "! Pro Controller not visible yet — starting pad router (press any button to wake)"
fi

ensure_sudo || exit 1

pkill -f stremio-pad-bridge.py 2>/dev/null || true
sudo -n pkill -f stremio-pad-bridge.py 2>/dev/null || true

ir_stop_service
hide_pro_controller_js
pkill -f mango-tv-pad.py 2>/dev/null || true
sudo -n pkill -f mango-tv-pad.py 2>/dev/null || true
ir_kill_readers
sleep 0.2

echo "Starting mango-tv-pad..."
BRIDGE_OK=false
for attempt in 1 2 3; do
  bash "$SCRIPT_DIR/connect-gamepad.sh" || true
  if ! pro_controller_present; then
    echo "! Pro Controller not visible (attempt $attempt/3)"
    sleep 1
    continue
  fi
  sudo -n "$PAD_RUN" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 0.5
  if pgrep -f '[m]ango-tv-pad\.py' >/dev/null 2>&1 && tail -3 "$LOG" 2>/dev/null | grep -q '^mango-tv-pad:'; then
    BRIDGE_OK=true
    break
  fi
  if tail -3 "$LOG" 2>/dev/null | grep -q 'Pro Controller not found'; then
    echo "! Pro Controller disappeared — reconnect Bluetooth"
    sleep 1
  fi
  pkill -f '[m]ango-tv-pad\.py' 2>/dev/null || true
  sudo -n pkill -f '[m]ango-tv-pad\.py' 2>/dev/null || true
  ir_kill_readers || true
  sleep 0.5
done

if $BRIDGE_OK; then
  echo "✓ mango TV pad running — log: $LOG"
  exit 0
fi

echo "! Pad failed to grab — log:"
tail -8 "$LOG" 2>/dev/null || true
echo ""
echo "Try: bash ~/mango/scripts/m1-foundation/pad/gamepad-fresh-start.sh"
echo "     sudo bash ~/mango/scripts/m1-foundation/pad/install-pad-sudoers.sh  # no password next time"
exit 1
