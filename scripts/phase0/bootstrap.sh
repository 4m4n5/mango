#!/usr/bin/env bash
# Phase 0 — clone repo on Pi and run full automated setup (after X11 is confirmed).
# Run on the Pi:
#   curl -fsSL ... OR git clone ... then:
#   bash scripts/phase0/bootstrap.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "=== mango Phase 0 bootstrap ==="
echo "Repo: $REPO_ROOT"
echo

bash scripts/phase0/verify-system.sh || {
  echo
  echo "Fix verify failures first. If not on X11, run:"
  echo "  bash scripts/phase0/switch-to-x11.sh && sudo reboot"
  exit 1
}

read -r -p "Install base dependencies (apt packages)? [Y/n] " deps
if [[ "${deps,,}" != "n" ]]; then
  bash scripts/phase0/install-base-deps.sh
fi

read -r -p "Install Kodi? [Y/n] " kodi
if [[ "${kodi,,}" != "n" ]]; then
  bash scripts/phase0/install-kodi.sh
fi

read -r -p "Install Stremio (.deb from fragarray)? [Y/n] " stremio
if [[ "${stremio,,}" != "n" ]]; then
  bash scripts/phase0/install-stremio.sh
fi

echo
echo "=== Automated steps done ==="
echo
echo "Manual steps remaining (see docs/phase0-checklist.md):"
echo "  [ ] Map gamepad in antimicrox (D-pad→arrows, A→Return, B→Escape)"
echo "  [ ] Kodi: install YouTube addon + enable JSON-RPC + play a video"
echo "  [ ] Stremio: login + addons + play content"
echo "  [ ] Test: bash scripts/phase0/test-kodi-rpc.sh <user> <pass>"
echo "  [ ] Note Pi IP: hostname -I"
