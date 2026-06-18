#!/usr/bin/env bash
# Phase 0 — install Kodi for YouTube.

set -euo pipefail

echo "=== Installing Kodi ==="
sudo apt update
sudo apt install -y kodi
bash "$(dirname "$0")/install-kodi-inputstream.sh"

echo
echo "=== Kodi installed ==="
echo
echo "YOU (on the Pi TV screen):"
echo "  1. Launch Kodi from the application menu"
echo "  2. Settings → Add-ons → Install from repository → Kodi Add-on repository"
echo "     → Video add-ons → YouTube → Install"
echo "  3. Settings → Services → Control:"
echo "     - Allow remote control via HTTP: ON"
echo "     - Web server port: 8080"
echo "     - Username + password: set these (you'll need them for voice control)"
echo "  4. Play any YouTube video using the gamepad"
echo
echo "Then run:  bash scripts/phase0/test-kodi-rpc.sh <user> <pass>"
