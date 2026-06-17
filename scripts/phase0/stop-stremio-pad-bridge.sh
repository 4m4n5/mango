#!/usr/bin/env bash
# Stop stremio-pad-bridge.
# Run on the Pi: bash scripts/phase0/stop-stremio-pad-bridge.sh

set -euo pipefail

PIDFILE="${HOME}/.cache/mango/stremio-pad-bridge.pid"

if [[ -f "$PIDFILE" ]]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  rm -f "$PIDFILE"
fi

pkill -f stremio-pad-bridge.py 2>/dev/null || true
sudo pkill -f stremio-pad-bridge.py 2>/dev/null || true

# Legacy root-owned pid from older scripts
sudo rm -f /tmp/mango-stremio-pad-bridge.pid 2>/dev/null || true

echo "✓ Pad bridge stopped"
