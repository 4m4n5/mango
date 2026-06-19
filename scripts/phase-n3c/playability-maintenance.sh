#!/usr/bin/env bash
# Dedicated maintenance window: stop couch UI, refresh playability index, restart stack.
#
# Usage:
#   bash scripts/phase-n3c/playability-maintenance.sh [--mode full|stale]
#
# Requires catalog-service config at /etc/mango but does not need the launcher up.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
MODE="${MANGO_PLAYABILITY_REFRESH_MODE:-stale}"
GATE_SAMPLE="${MANGO_N3C_GATE_MAX_PER_RAIL:-2}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

cd "$REPO_DIR"

echo "== mango playability maintenance (mode=$MODE) =="

if pgrep -f 'mango-launcher|chromium.*127.0.0.1:3000' >/dev/null 2>&1; then
  echo "stopping launcher/chromium for dedicated maintenance window"
  pkill -f 'chromium.*127.0.0.1:3000' 2>/dev/null || true
  sleep 1
fi

# Keep catalog-service up for stream resolve unless explicitly disabled.
if ! curl -sf http://127.0.0.1:3020/health >/dev/null 2>&1; then
  echo "catalog-service not healthy — starting lean stack"
  MANGO_CATALOG=1 MANGO_PLAYABILITY_TOPUP_ON_START=0 bash scripts/mango-stack.sh start
  sleep 3
fi

START_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"

export MANGO_MAINTENANCE_MODE=1
export MANGO_PLAYABILITY_PROBE_POOL=1
export MANGO_PLAYABILITY_BATCH_DB=1
export MANGO_PLAYABILITY_RESOLVE_CONCURRENCY="${MANGO_PLAYABILITY_RESOLVE_CONCURRENCY:-8}"
export MANGO_PLAYABILITY_PROBE_CONCURRENCY="${MANGO_PLAYABILITY_PROBE_CONCURRENCY:-3}"
export MANGO_PLAYABILITY_PROBE_MS="${MANGO_PLAYABILITY_PROBE_MS:-6000}"

set +e
REFRESH_JSON="$(npm --prefix src/catalog-service exec tsx -- scripts/phase-n3c/playability-indexer.ts refresh --all --mode "$MODE" 2>&1)"
REFRESH_RC=$?
set -e
echo "$REFRESH_JSON"

END_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
echo "maintenance refresh rc=$REFRESH_RC duration_ms=$((END_MS - START_MS))"

bash scripts/phase-n3c/mpv-probe-pool.sh stop-all >/dev/null 2>&1 || true

if [[ "$REFRESH_RC" -ne 0 ]]; then
  echo "refresh failed" >&2
  exit "$REFRESH_RC"
fi

if [[ -x "$REPO_DIR/scripts/pi-pre-couch-gate.sh" ]]; then
  echo "running sampled pre-couch gate"
  MANGO_N3C_GATE_MAX_PER_RAIL="$GATE_SAMPLE" bash "$REPO_DIR/scripts/pi-pre-couch-gate.sh" || {
    echo "gate failed after maintenance — inspect playability status" >&2
    exit 1
  }
fi

echo "maintenance complete"
