#!/usr/bin/env bash
# Disable background services unused on a TV kiosk Pi. Run once on the Pi.

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  exec sudo -n bash "$0" "$@"
fi

echo "=== Disabling packagekit (background apt metadata) ==="
systemctl disable --now packagekit.service packagekit.socket 2>/dev/null || true
systemctl mask packagekit.service packagekit.socket 2>/dev/null || true

echo "=== Optional: reduce mDNS noise (avahi) ==="
if [[ "${MANGO_DISABLE_AVAHI:-0}" == "1" ]]; then
  systemctl disable --now avahi-daemon.service avahi-daemon.socket 2>/dev/null || true
fi

echo "✓ kiosk bloat reduced"
