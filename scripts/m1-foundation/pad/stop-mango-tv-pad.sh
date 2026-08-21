#!/usr/bin/env bash
# Stop mango TV pad router.

set -euo pipefail

PIDFILE="${HOME}/.cache/mango/mango-tv-pad.pid"

if [[ -f "$PIDFILE" ]]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  rm -f "$PIDFILE"
fi

pkill -f mango-tv-pad.py 2>/dev/null || true
sudo -n pkill -f mango-tv-pad.py 2>/dev/null || true

echo "✓ mango TV pad stopped"
