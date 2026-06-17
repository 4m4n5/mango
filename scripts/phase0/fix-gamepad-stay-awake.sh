#!/usr/bin/env bash
# Keep FastPad USB dongle powered (no autosuspend). Does NOT use udev RUN+ hooks
# (those caused connect/disconnect loops with input-remapper).
# Run on the Pi: bash scripts/phase0/fix-gamepad-stay-awake.sh

set -euo pipefail

VENDOR="1a86"
PRODUCT="fe18"
UDEV_USB="/etc/udev/rules.d/99-mango-fastpad-usb-power.rules"

echo "=== mango: FastPad USB power (safe) ==="

# Remove loop-causing rules from earlier version
sudo rm -f \
  /etc/udev/rules.d/99-mango-fastpad-remap.rules \
  /usr/local/bin/mango-gamepad-autoload

echo "Writing $UDEV_USB"
sudo tee "$UDEV_USB" >/dev/null <<EOF
# FastPad 2.4G receiver — prevent Pi from suspending the USB port
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="${VENDOR}", ATTR{idProduct}=="${PRODUCT}", \\
  ATTR{power/control}="on", ATTR{power/autosuspend}="-1"
EOF

sudo udevadm control --reload-rules

sudo systemctl enable input-remapper 2>/dev/null \
  || sudo systemctl enable input-remapper-daemon 2>/dev/null \
  || true
sudo systemctl start input-remapper 2>/dev/null || true

for usb in /sys/bus/usb/devices/*; do
  [[ -f "$usb/idVendor" && -f "$usb/idProduct" ]] || continue
  if [[ "$(cat "$usb/idVendor")" == "$VENDOR" && "$(cat "$usb/idProduct")" == "$PRODUCT" ]]; then
    if [[ -f "$usb/power/control" ]]; then
      echo on | sudo tee "$usb/power/control" >/dev/null
      echo -1 | sudo tee "$usb/power/autosuspend" >/dev/null 2>/dev/null || true
      echo "USB power: on for $(basename "$usb")"
    fi
  fi
done

input-remapper-control --command autoload 2>/dev/null || true

echo
echo "Done. USB autosuspend disabled for FastPad only."
echo "After pad sleep: press any button; if dead run:"
echo "  input-remapper-control --command autoload"
echo
echo "Pad wireless drops: fresh batteries, re-pair, direct USB port."
