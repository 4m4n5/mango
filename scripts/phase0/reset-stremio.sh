#!/usr/bin/env bash
# Clean Stremio restart: kill zombies → remap gamepad → launch + focus.
# Run on the Pi: bash scripts/phase0/reset-stremio.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

bash "$SCRIPT_DIR/kill-stremio.sh" || {
  echo "! kill-stremio had warnings — continuing launch anyway"
}

echo
bash "$SCRIPT_DIR/launch-stremio.sh"
