#!/usr/bin/env bash
# Launch Stremio with keyboard remapping ON (for desktop/Qt apps).
# Run on the Pi: bash scripts/phase0/launch-stremio.sh

set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

bash "$(dirname "$0")/map-pro-controller.sh"

echo "Starting Stremio..."
stremio &

echo
echo "Desktop map: D-pad = arrows, A = Return, B = Escape"
