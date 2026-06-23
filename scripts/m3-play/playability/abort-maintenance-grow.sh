#!/usr/bin/env bash
# Abort an in-flight grow/maintenance and restore the couch stack.
#
#   bash scripts/m3-play/playability/abort-maintenance-grow.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
cd "$REPO_DIR"

echo "abort: stopping playability grow/maintenance"

if [[ -f "$CACHE_DIR/playability-grow.pid" ]]; then
  pid="$(cat "$CACHE_DIR/playability-grow.pid" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$CACHE_DIR/playability-grow.pid"
fi

if [[ -f "$CACHE_DIR/overnight-fill.pid" ]]; then
  opid="$(cat "$CACHE_DIR/overnight-fill.pid" 2>/dev/null || true)"
  if [[ -n "$opid" ]] && kill -0 "$opid" 2>/dev/null; then
    kill "$opid" 2>/dev/null || true
    sleep 1
    kill -9 "$opid" 2>/dev/null || true
  fi
  rm -f "$CACHE_DIR/overnight-fill.pid"
fi

pkill -f '[p]layability-indexer.ts' 2>/dev/null || true
pkill -f '[p]layability-maintenance.sh' 2>/dev/null || true
pkill -f '[o]vernight-playability-grow.sh' 2>/dev/null || true
bash scripts/m3-play/playability/mpv-probe-pool.sh stop-all >/dev/null 2>&1 || true
rm -f "$CACHE_DIR/playability-maintenance.lock"
rm -f "$CACHE_DIR/overnight-fill.lock"

python3 scripts/diag/grow_run_state.py set \
  --phase done \
  --message "aborted — couch restore" 2>/dev/null || true

bash scripts/mango-kill-strays.sh >/dev/null 2>&1 || true
MANGO_CATALOG=1 MANGO_PLAYABILITY_TOPUP_ON_START=0 bash scripts/mango-refresh.sh

echo "abort: couch restore complete"
python3 scripts/diag/grow_monitor.py status 2>/dev/null || true
