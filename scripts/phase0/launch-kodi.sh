#!/usr/bin/env bash
# Launch Kodi with native Pro Controller (input-remapper OFF).
# Kodi maps A=select, B=back itself — keyboard remapping breaks this.
# Run on the Pi: bash scripts/phase0/launch-kodi.sh

set -euo pipefail

DEVICE="Pro Controller"

input-remapper-control --command stop --device "$DEVICE" 2>/dev/null || true
sudo modprobe joydev 2>/dev/null || true

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

echo "Starting Kodi (native gamepad — remapper off for Pro Controller)..."
kodi &

echo
echo "On first use in Kodi, enable controllers if needed:"
echo "  Settings → Input → Peripherals → joysticks → enable"
echo
echo "Controls in Kodi (native):"
echo "  D-pad = move   A = select   B = back"
echo
echo "When done, for Stremio/desktop: bash scripts/phase0/launch-stremio.sh"
