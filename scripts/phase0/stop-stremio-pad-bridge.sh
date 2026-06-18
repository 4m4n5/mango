#!/usr/bin/env bash
# Stop stremio-pad-bridge.
# Run on the Pi: bash scripts/phase0/stop-stremio-pad-bridge.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/gamepad-js.sh
source "$SCRIPT_DIR/lib/gamepad-js.sh"

PIDFILE="${HOME}/.cache/mango/stremio-pad-bridge.pid"

if [[ -f "$PIDFILE" ]]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  rm -f "$PIDFILE"
fi

pkill -f stremio-pad-bridge.py 2>/dev/null || true
sudo pkill -f stremio-pad-bridge.py 2>/dev/null || true

# Legacy root-owned pid from older scripts
sudo rm -f /tmp/mango-stremio-pad-bridge.pid 2>/dev/null || true

restore_hidden_js

echo "✓ Pad bridge stopped"
