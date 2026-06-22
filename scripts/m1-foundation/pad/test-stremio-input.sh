#!/usr/bin/env bash
# Verify keyboard events reach Stremio (after focus).
# Run on the Pi: bash scripts/m1-foundation/pad/test-stremio-input.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if ! pgrep -x stremio >/dev/null 2>&1 && ! pgrep -f '/opt/stremio' >/dev/null 2>&1; then
  echo "! Stremio not running — bash scripts/m1-foundation/pad/reset-stremio.sh"
  exit 1
fi

bash "$SCRIPT_DIR/focus-stremio.sh" || exit 1

if ! command -v xdotool &>/dev/null; then
  echo "Install xdotool: sudo apt install -y xdotool"
  exit 1
fi

echo "Sending test Down arrow to focused window..."
xdotool key Down
echo "✓ If Stremio UI moved, keyboard path works — try the controller."
echo "  If nothing moved, run: bash scripts/m1-foundation/pad/map-pro-controller.sh"
echo "  Then: bash scripts/m1-foundation/pad/focus-stremio.sh"
