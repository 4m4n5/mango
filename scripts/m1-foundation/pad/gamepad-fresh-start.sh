#!/usr/bin/env bash
# After reboot: connect 8BitDo, verify input, keep remapper OFF until pad works.
# Run on the Pi: bash scripts/m1-foundation/pad/gamepad-fresh-start.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/irctl.sh
source "$SCRIPT_DIR/lib/irctl.sh"

BT_MAC="E4:17:D8:EB:00:44"
DEVICE_NAME="Pro Controller"

find_pro_controller_event() {
  python3 - <<'PY'
import evdev
from evdev import ecodes

required_keys = {304, 308}
stick_abs = {ecodes.ABS_X, ecodes.ABS_Y}
hat_abs = {ecodes.ABS_HAT0X, ecodes.ABS_HAT0Y}
for path in evdev.list_devices():
    dev = evdev.InputDevice(path)
    if dev.name != "Pro Controller":
        continue
    caps = dev.capabilities()
    keys = set(caps.get(ecodes.EV_KEY, []))
    abs_axes = {
        item[0] if isinstance(item, tuple) else item
        for item in caps.get(ecodes.EV_ABS, [])
    }
    if required_keys.issubset(keys) and (
        stick_abs.issubset(abs_axes) or hat_abs.issubset(abs_axes)
    ):
        print(path)
        raise SystemExit(0)
raise SystemExit(1)
PY
}

bt_connect() {
  bluetoothctl <<EOF
power on
connect ${BT_MAC}
EOF
}

wait_for_input_device() {
  local secs=$1 ev
  echo "Waiting up to ${secs}s for input device (press any button on the pad)..." >&2
  for _ in $(seq 1 "$secs"); do
    ev=$(find_pro_controller_event) && { echo "$ev"; return 0; }
    sleep 1
  done
  return 1
}

echo "=== mango: gamepad fresh start ==="
echo

ir_stop_service

if lsusb 2>/dev/null | grep -qiE 'fastpad|1a86:fe18'; then
  echo "! Unplug the FastPad USB dongle — it conflicts with 8BitDo."
fi

echo "=== Bluetooth: connect Pro Controller ==="
sudo systemctl start bluetooth 2>/dev/null || true
sudo modprobe joydev 2>/dev/null || true
sudo modprobe hid_nintendo 2>/dev/null || true

bt_connect
sleep 2

if ! bluetoothctl info "$BT_MAC" 2>/dev/null | grep -q "Connected: yes"; then
  echo "! Not connected — on pad hold START+Y ~3s, then:"
  echo "  bluetoothctl connect ${BT_MAC}"
  exit 1
fi
echo "✓ Bluetooth connected"

echo
echo "=== Input devices ==="

EVENT_DEV=$(wait_for_input_device 20) || EVENT_DEV=""

if [[ -z "$EVENT_DEV" ]]; then
  echo "! Input not registered yet — reconnecting..."
  bluetoothctl disconnect "$BT_MAC" 2>/dev/null || true
  sleep 2
  bt_connect
  sleep 2
  EVENT_DEV=$(wait_for_input_device 25) || EVENT_DEV=""
fi

if [[ -z "$EVENT_DEV" ]]; then
  grep -i 'pro controller' /proc/bus/input/devices || echo "! Pro Controller not in /proc/bus/input/devices"
  echo
  echo "! No /dev/input/event* yet. On the Micro:"
  echo "  1. Press any button to wake it"
  echo "  2. bluetoothctl connect ${BT_MAC}"
  echo "  3. Re-run: bash scripts/m1-foundation/pad/gamepad-fresh-start.sh"
  echo
  echo "  Check: bluetoothctl info ${BT_MAC}"
  exit 1
fi

grep -i 'pro controller' /proc/bus/input/devices || true
echo "Gamepad event device: $EVENT_DEV (not IMU)"

echo
if [[ -t 0 ]]; then
  read -r -p "Press ENTER, then press D-pad and B on the controller (15s test)..."
else
  echo "(non-interactive — skipping ENTER prompt; press D-pad / B now)"
fi

echo "Listening..."
set +e
EVTEST_OUT=$(timeout 15 sudo evtest "$EVENT_DEV" 2>&1)
EVTEST_LINES=$(echo "$EVTEST_OUT" | grep -E 'Event:.*(EV_KEY|EV_ABS)' | head -20)
set -e

if [[ -n "$EVTEST_LINES" ]]; then
  echo "✓ Controller input detected:"
  echo "$EVTEST_LINES"
else
  echo "! No input detected on $EVENT_DEV"
  echo "  - Press any button to wake the pad"
  echo "  - Run: bluetoothctl connect ${BT_MAC}"
  if echo "$EVTEST_OUT" | grep -qi 'grabbed by another process'; then
    echo "  - Device is grabbed — run: sudo systemctl stop input-remapper"
  fi
fi

echo
echo "=== Remapper: OFF (evtest only) ==="
if [[ "${MANGO_AUTO_PAD:-1}" == "1" ]]; then
  echo "Starting mango TV pad router..."
  bash "$SCRIPT_DIR/start-mango-tv-pad.sh" || true
fi
echo "Next: MANGO_CATALOG=1 bash scripts/mango-stack.sh restart"
echo "Reconnect: press any button on the Micro (trusted BT auto-connect)"
