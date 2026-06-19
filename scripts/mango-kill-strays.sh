#!/usr/bin/env bash
# Stop stray mpv / playability indexer / gate leftovers. Safe during couch use.
# Usage: bash scripts/mango-kill-strays.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"

pkill -f 'playability-indexer' 2>/dev/null || true
pkill -f 'tsx.*phase-n3c' 2>/dev/null || true
pkill -f 'gate-n3c-verified-rails' 2>/dev/null || true
pkill -f 'gate-n3-play' 2>/dev/null || true
pkill -f 'curl.*127.0.0.1:3020/play' 2>/dev/null || true

if [[ -x "$REPO_DIR/scripts/phase-n1/mpv-stop.sh" ]]; then
  bash "$REPO_DIR/scripts/phase-n1/mpv-stop.sh" 2>/dev/null || true
fi
pkill -x mpv 2>/dev/null || true

sleep 0.3
if pgrep -x mpv >/dev/null 2>&1 || pgrep -f playability-indexer >/dev/null 2>&1; then
  echo "strays: some processes remain" >&2
  pgrep -a mpv 2>/dev/null || true
  pgrep -af playability 2>/dev/null || true
  exit 1
fi

echo "strays: cleared"
