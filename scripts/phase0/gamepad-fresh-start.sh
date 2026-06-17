#!/usr/bin/env bash
# After reboot: connect 8BitDo, verify input, keep remapper OFF until pad works.
# Run on the Pi: bash scripts/phase0/gamepad-fresh-start.sh

set -euo pipefail

BT_MAC="E4:17:D8:EB:00:44"
DEVICE_NAME="Pro Controller"

echo "=== mango: gamepad fresh start ==="
echo

# Stop remapper — it often breaks native Kodi input
sudo systemctl stop input-remapper 2>/dev/null || true
input-remapper-control --command stop --device "$DEVICE_NAME" 2>/dev/null || true

if lsusb 2>/dev/null | grep -qiE 'fastpad|1a86:fe18'; then
  echo "! Unplug the FastPad USB dongle — it conflicts with 8BitDo."
fi

echo "=== Bluetooth: connect Pro Controller ==="
sudo systemctl start bluetooth 2>/dev/null || true
bluetoothctl <<EOF
power on
agent on
default-agent
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
ls -la /dev/input/js* 2>/dev/null || echo "(no js* — joydev loads on boot after reboot)"
echo
echo "Event nodes:"
grep -B5 -i 'pro controller' /proc/bus/input/devices | grep -E 'Handlers|Name' || true

EVENT=$(grep -l -i 'pro controller' /sys/class/input/event*/device/name 2>/dev/null | head -1 | xargs basename 2>/dev/null || true)
if [[ -n "$EVENT" ]]; then
  echo
  echo "Quick test (5s) — press D-pad and A on the controller:"
  timeout 5 sudo evtest "/dev/input/${EVENT}" 2>&1 | grep -E 'EV_KEY|EV_ABS' | head -15 || echo "(no events — wake pad with any button)"
fi

echo
echo "=== Remapper: OFF (native pad for Kodi) ==="
echo
echo "Next:"
echo "  bash scripts/phase0/launch-kodi.sh"
echo
echo "In Kodi TV UI: Settings → Input → Peripherals → joysticks → ON"
echo
echo "Stremio later: bash scripts/phase0/launch-stremio.sh"
echo "Reconnect: bluetoothctl connect ${BT_MAC}"
