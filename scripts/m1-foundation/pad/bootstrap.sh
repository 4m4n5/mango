#!/usr/bin/env bash
# M1 foundation — clone repo on Pi and run automated bring-up (after X11 is confirmed).
# Run on the Pi:
#   git clone … && bash scripts/m1-foundation/pad/bootstrap.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "=== mango M1 foundation bootstrap ==="
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

echo
echo "=== Automated steps done ==="
echo
echo "Manual steps remaining (see docs/archive/phase0-checklist.md):"
echo "  [ ] Remap gamepad: bash scripts/m1-foundation/pad/install-gamepad-remap.sh (FastPad) or antimicrox (js0)"
echo "  [ ] Install systemd units: bash scripts/m1-foundation/ui/install-systemd-units.sh"
echo "  [ ] Start stack: MANGO_CATALOG=1 bash scripts/mango-stack.sh restart"
echo "  [ ] Note Pi IP: hostname -I"
