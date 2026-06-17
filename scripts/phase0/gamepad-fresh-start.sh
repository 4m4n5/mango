#!/usr/bin/env bash
# After reboot: connect 8BitDo, verify input, keep remapper OFF until pad works.
# Run on the Pi: bash scripts/phase0/gamepad-fresh-start.sh

set -euo pipefail

BT_MAC="E4:17:D8:EB:00:44"
DEVICE_NAME="Pro Controller"

find_pro_controller_event() {
  local f name ev
  for f in /sys/class/input/event*/device/name; do
    [[ -f "$f" ]] || continue
    name=$(tr -d '\n' <"$f")
    # Main gamepad only — not "Pro Controller (IMU)"
    [[ "$name" == "Pro Controller" ]] || continue
    ev=$(basename "$(dirname "$(dirname "$f")")")
    echo "/dev/input/${ev}"
    return 0
  done
  return 1
}

echo "=== mango: gamepad fresh start ==="
echo

sudo systemctl stop input-remapper 2>/dev/null || true
input-remapper-control --command stop --device "$DEVICE_NAME" 2>/dev/null || true

if lsusb 2>/dev/null | grep -qiE 'fastpad|1a86:fe18'; then
  echo "! Unplug the FastPad USB dongle — it conflicts with 8BitDo."
fi

echo "=== Bluetooth: connect Pro Controller ==="
sudo systemctl start bluetooth 2>/dev/null || true
bluetoothctl <<EOF
power on
connect ${BT_MAC}
EOF
sleep 3

if bluetoothctl info "$BT_MAC" 2>/dev/null | grep -q "Connected: yes"; then
  echo "✓ Bluetooth connected"
else
  echo "! Not connected — on pad hold START+Y ~3s, then run:"
  echo "  bluetoothctl connect ${BT_MAC}"
  exit 1
fi

echo
echo "=== Input devices ==="
sudo modprobe joydev 2>/dev/null || true
grep -i 'pro controller' /proc/bus/input/devices || echo "! Pro Controller not in /proc/bus/input/devices"
ls -la /dev/input/js* 2>/dev/null || echo "(no js* yet — OK if joydev just loaded)"

EVENT_DEV=$(find_pro_controller_event) || EVENT_DEV=""
if [[ -z "$EVENT_DEV" ]]; then
  echo "! Could not find /dev/input/event* for Pro Controller (non-IMU)"
  exit 1
fi
echo "Gamepad event device: $EVENT_DEV (not IMU)"

echo
read -r -p "Press ENTER, then press D-pad and A on the controller (15s test)..."

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
  echo "  - Manual test: sudo evtest $EVENT_DEV"
  if echo "$EVTEST_OUT" | grep -qi 'grabbed by another process'; then
    echo "  - Device is grabbed — run: sudo systemctl stop input-remapper"
  fi
fi

echo
echo "=== Remapper: OFF (evtest only) ==="
echo "Next: bash scripts/phase0/launch-kodi.sh   (or launch-stremio.sh)"
echo "Use the D-pad to navigate in Kodi/Stremio."
echo "Reconnect: bluetoothctl connect ${BT_MAC}"
