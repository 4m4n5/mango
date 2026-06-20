#!/usr/bin/env bash
# Stop stray mpv / playability indexer / gate leftovers / debug shells. Safe during couch use.
# Usage: bash scripts/mango-kill-strays.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"

pkill -f 'playability-indexer' 2>/dev/null || true
pkill -f 'tsx.*phase-n3c' 2>/dev/null || true
pkill -f 'gate-n3c-verified-rails' 2>/dev/null || true
pkill -f 'gate-n3c-verified' 2>/dev/null || true
pkill -f 'curl.*127.0.0.1:3020/play' 2>/dev/null || true
pkill -f 'node --input-type=module -e.*CatalogCore' 2>/dev/null || true

if [[ -x "$REPO_DIR/scripts/phase-n1/mpv-stop.sh" ]]; then
  bash "$REPO_DIR/scripts/phase-n1/mpv-stop.sh" 2>/dev/null || true
fi
pkill -x mpv 2>/dev/null || true

sleep 0.3
remaining=0
if pgrep -x mpv >/dev/null 2>&1; then
  remaining=1
  pgrep -a mpv 2>/dev/null || true
fi
if pgrep -f playability-indexer >/dev/null 2>&1; then
  remaining=1
  pgrep -af playability 2>/dev/null || true
fi
if pgrep -f 'node --input-type=module -e.*CatalogCore' >/dev/null 2>&1; then
  remaining=1
  pgrep -af 'node --input-type=module' 2>/dev/null || true
fi

if (( remaining != 0 )); then
  echo "strays: some processes remain" >&2
  exit 1
fi

if [[ -x "$REPO_DIR/scripts/lib/stale-flock-cleanup.sh" ]]; then
  bash "$REPO_DIR/scripts/lib/stale-flock-cleanup.sh" || true
fi

echo "strays: cleared"
