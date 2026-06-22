#!/usr/bin/env bash
# Phase 0 — switch to X11 Openbox (required for mango).
# Run on the Pi, then reboot when prompted.

set -euo pipefail

echo "=== Switching to X11 Openbox ==="
echo "Current session: ${XDG_SESSION_TYPE:-unknown}"
echo

if [[ "${XDG_SESSION_TYPE:-}" == "x11" ]]; then
  echo "Already on X11. No change needed."
  exit 0
fi

if ! command -v raspi-config &>/dev/null; then
  echo "raspi-config not found. Switch manually:"
  echo "  sudo raspi-config → Advanced → Wayland → X11 Openbox"
  exit 1
fi

echo "Applying X11 Openbox via raspi-config..."
sudo raspi-config nonint do_wayland W1

echo
echo "Done. Reboot required:"
echo "  sudo reboot"
echo
echo "After reboot, verify:  echo \$XDG_SESSION_TYPE   # should print x11"
