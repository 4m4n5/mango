#!/usr/bin/env bash
# Restart Phase 1 mango UI on the Pi.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

bash "$SCRIPT_DIR/stop-mango-ui.sh"
bash "$REPO_DIR/scripts/m1-foundation/pad/kill-stremio.sh" 2>/dev/null || true
bash "$SCRIPT_DIR/start-mango-ui.sh"
