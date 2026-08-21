#!/usr/bin/env bash
# Remove mango udev rules that can cause FastPad connect/disconnect loops.
# Run on the Pi: bash scripts/m1-foundation/pad/undo-gamepad-stay-awake.sh

set -euo pipefail

echo "=== Stopping connect/disconnect loop ==="

sudo rm -f \
  /etc/udev/rules.d/99-mango-fastpad-usb-power.rules \
  /etc/udev/rules.d/99-mango-fastpad-remap.rules \
  /usr/local/bin/mango-gamepad-autoload

sudo udevadm control --reload-rules

echo "Stopped input-remapper (clears device grab)..."
sudo systemctl stop input-remapper 2>/dev/null || true
sleep 2

echo "Unplug the gamepad dongle for 5 seconds, plug back in, wait 3 seconds."
read -r -p "Press Enter when dongle is plugged back in..."

sudo systemctl start input-remapper 2>/dev/null || true
sleep 1
input-remapper-control --command autoload 2>/dev/null || true

echo
echo "Loop rules removed. Mapping re-applied once."
echo "If stable now, the old udev autoload rule was the cause."
echo "Optional USB-only fix (no autoload loop): bash scripts/m1-foundation/pad/fix-gamepad-stay-awake.sh"
