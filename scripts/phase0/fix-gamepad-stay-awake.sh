#!/usr/bin/env bash
# Keep FastPad dongle awake on Pi + re-apply input-remapper after reconnect.
# Run on the Pi: bash scripts/phase0/fix-gamepad-stay-awake.sh

set -euo pipefail

VENDOR="1a86"
PRODUCT="fe18"
UDEV_USB="/etc/udev/rules.d/99-mango-fastpad-usb-power.rules"
UDEV_INPUT="/etc/udev/rules.d/99-mango-fastpad-remap.rules"
AUTOLOAD_SCRIPT="/usr/local/bin/mango-gamepad-autoload"

echo "=== mango: keep gamepad dongle connected ==="

# 1. Stop USB autosuspend for the FastPad dongle
echo "Writing $UDEV_USB"
sudo tee "$UDEV_USB" >/dev/null <<EOF
# FastPad 2.4G receiver — prevent Pi from suspending the USB port
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="${VENDOR}", ATTR{idProduct}=="${PRODUCT}", \\
  ATTR{power/control}="on", ATTR{power/autosuspend}="-1"
EOF

# 2. Re-apply input-remapper preset when pad reconnects
PI_USER="${SUDO_USER:-$USER}"
echo "Writing $AUTOLOAD_SCRIPT (user: $PI_USER)"
sudo tee "$AUTOLOAD_SCRIPT" >/dev/null <<EOF
#!/bin/sh
# Re-apply mango-tv preset after FastPad reconnect (called from udev).
sleep 1
if command -v input-remapper-control >/dev/null 2>&1; then
  systemctl start input-remapper 2>/dev/null || true
  for dev in /dev/input/event*; do
    name=\$(cat "/sys/class/input/\$(basename "\$dev")/device/name" 2>/dev/null || true)
    case "\$name" in
      *FastPad*|*fastpad*)
        su - "${PI_USER}" -c "input-remapper-control --command autoload --device \$dev" 2>/dev/null || true
        ;;
    esac
  done
fi
EOF
sudo chmod +x "$AUTOLOAD_SCRIPT"

echo "Writing $UDEV_INPUT"
sudo tee "$UDEV_INPUT" >/dev/null <<EOF
# Re-apply gamepad remap when FastPad input device appears
ACTION=="add", SUBSYSTEM=="input", ATTRS{idVendor}=="${VENDOR}", ATTRS{idProduct}=="${PRODUCT}", \\
  RUN+="${AUTOLOAD_SCRIPT}"
EOF

sudo udevadm control --reload-rules
sudo udevadm trigger

# 3. input-remapper always at boot
sudo systemctl enable input-remapper 2>/dev/null \
  || sudo systemctl enable input-remapper-daemon 2>/dev/null \
  || true
sudo systemctl start input-remapper 2>/dev/null || true

# 4. Apply to currently plugged dongle (if present)
for usb in /sys/bus/usb/devices/*; do
  [[ -f "$usb/idVendor" && -f "$usb/idProduct" ]] || continue
  if [[ "$(cat "$usb/idVendor")" == "$VENDOR" && "$(cat "$usb/idProduct")" == "$PRODUCT" ]]; then
    if [[ -f "$usb/power/control" ]]; then
      echo on | sudo tee "$usb/power/control" >/dev/null
      echo -1 | sudo tee "$usb/power/autosuspend" >/dev/null 2>/dev/null || true
      echo "USB power: on (no autosuspend) for $(basename "$usb")"
    fi
  fi
done

input-remapper-control --command autoload 2>/dev/null || true

echo
echo "=== Pi-side done ==="
echo
echo "If the PAD (not dongle) still drops after idle, that is controller sleep:"
echo "  - Fresh batteries or full charge"
echo "  - Press any button to wake after idle"
echo "  - Re-sync: power on pad, hold pair/sync until LED stops flashing"
echo "  - Dongle in a direct Pi USB port (not through a hub)"
echo
echo "Check disconnect cause: sudo dmesg -T | tail -20  (right after a drop)"
