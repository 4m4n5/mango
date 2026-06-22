#!/usr/bin/env bash
# Phase 0 — clone repo on Pi and run full automated setup (after X11 is confirmed).
# Run on the Pi:
#   curl -fsSL ... OR git clone ... then:
#   bash scripts/m1-foundation/pad/bootstrap.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "=== mango Phase 0 bootstrap ==="
echo "Repo: $REPO_ROOT"
echo

bash scripts/m1-foundation/pad/verify-system.sh || {
  echo
  echo "Fix verify failures first. If not on X11, run:"
  echo "  bash scripts/m1-foundation/pad/switch-to-x11.sh && sudo reboot"
  exit 1
}

read -r -p "Install base dependencies (apt packages)? [Y/n] " deps
if [[ "${deps,,}" != "n" ]]; then
  bash scripts/m1-foundation/pad/install-base-deps.sh
fi

read -r -p "Install Kodi? [Y/n] " kodi
if [[ "${kodi,,}" != "n" ]]; then
  bash scripts/m1-foundation/pad/install-kodi.sh
fi

read -r -p "Install Stremio (.deb from fragarray)? [Y/n] " stremio
if [[ "${stremio,,}" != "n" ]]; then
  bash scripts/m1-foundation/pad/install-stremio.sh
fi

echo
echo "=== Automated steps done ==="
echo
echo "Manual steps remaining (see docs/archive/phase0-checklist.md):"
echo "  [ ] Remap gamepad: bash scripts/m1-foundation/pad/install-gamepad-remap.sh (FastPad) or antimicrox (js0)"
echo "  [ ] Kodi: install YouTube addon + enable JSON-RPC + play a video"
echo "  [ ] Stremio: login + addons + play content"
echo "  [ ] Test: bash scripts/m1-foundation/pad/test-kodi-rpc.sh <user> <pass>"
echo "  [ ] Note Pi IP: hostname -I"
