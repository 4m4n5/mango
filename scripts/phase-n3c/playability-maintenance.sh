#!/usr/bin/env bash
# Dedicated maintenance: stop couch UI + catalog-service, refresh playability, restore stack.
#
# Usage:
#   bash scripts/phase-n3c/playability-maintenance.sh [--mode full|stale]
#
# Env:
#   MANGO_MAINTENANCE_ALLOW_PARTIAL=1  exit 0 when refresh ran but pools below min_display (default 1)
#   MANGO_MAINTENANCE_SKIP_GATE=1      skip pi-pre-couch-gate after refresh (default 1 for --mode full)
#   MANGO_PLAYABILITY_BOOTSTRAP=1      target min_display per rail + early exit (set by --bootstrap)
#   MANGO_N3C_GATE_MAX_PER_RAIL        sampled plays per rail (default 2)

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
LOCK_FILE="${CACHE_DIR}/playability-maintenance.lock"
MODE="${MANGO_PLAYABILITY_REFRESH_MODE:-stale}"
GATE_SAMPLE="${MANGO_N3C_GATE_MAX_PER_RAIL:-2}"
ALLOW_PARTIAL="${MANGO_MAINTENANCE_ALLOW_PARTIAL:-1}"
SKIP_GATE="${MANGO_MAINTENANCE_SKIP_GATE:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --bootstrap) export MANGO_PLAYABILITY_BOOTSTRAP=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ "$MODE" == "full" || "$MODE" == "stale" ]] || { echo "mode must be full or stale" >&2; exit 2; }
if [[ -z "$SKIP_GATE" ]]; then
  SKIP_GATE=$([[ "$MODE" == "full" ]] && echo 1 || echo 0)
fi

mkdir -p "$CACHE_DIR"

# shellcheck source=../lib/catalog-yaml.sh
source "$REPO_DIR/scripts/lib/catalog-yaml.sh"
export MANGO_CATALOG_YAML="$(resolve_catalog_yaml)" || exit 1
echo "catalog: $MANGO_CATALOG_YAML"

# Use fd 200 — fd 9 is often inherited by catalog-service/chromium children.
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "another maintenance run is in progress ($LOCK_FILE)" >&2
  exit 2
fi

cd "$REPO_DIR"

preflight_native_deps() {
  if ! node -e "require('./src/catalog-service/node_modules/better-sqlite3')" >/dev/null 2>&1; then
    echo "rebuilding better-sqlite3 for this platform"
    npm rebuild better-sqlite3 --prefix src/catalog-service
  fi
}
preflight_native_deps

restore_couch() {
  bash scripts/phase-n3c/mpv-probe-pool.sh stop-all >/dev/null 2>&1 || true
  bash scripts/mango-kill-strays.sh >/dev/null 2>&1 || true
  MANGO_CATALOG=1 MANGO_PLAYABILITY_TOPUP_ON_START=0 bash scripts/mango-refresh.sh >/dev/null 2>&1 \
    || echo "warn: mango-refresh failed — run manually" >&2
}

trap restore_couch EXIT

stop_catalog_service() {
  local pid_file="${CACHE_DIR}/catalog-service.pid"
  if [[ -f "$pid_file" ]]; then
    kill "$(cat "$pid_file")" 2>/dev/null || true
    sleep 0.3
    kill -9 "$(cat "$pid_file")" 2>/dev/null || true
    rm -f "$pid_file"
  fi
  pkill -f '[c]atalog-service/dist/index.js' 2>/dev/null || true
  sleep 0.5
}

echo "== mango playability maintenance (mode=$MODE) =="

if pgrep -f 'chromium.*127.0.0.1:3000' >/dev/null 2>&1; then
  echo "stopping chromium"
  pkill -f 'chromium.*127.0.0.1:3000' 2>/dev/null || true
  sleep 1
fi

if curl -sf --max-time 2 http://127.0.0.1:3020/health >/dev/null 2>&1; then
  echo "stopping catalog-service (exclusive indexer)"
  stop_catalog_service
fi

START_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"

export MANGO_MAINTENANCE_MODE=1
export MANGO_PLAYABILITY_PROBE_POOL=1
export MANGO_PLAYABILITY_BATCH_DB=1
export MANGO_PLAYABILITY_RESOLVE_CONCURRENCY="${MANGO_PLAYABILITY_RESOLVE_CONCURRENCY:-4}"
export MANGO_PLAYABILITY_PROBE_CONCURRENCY="${MANGO_PLAYABILITY_PROBE_CONCURRENCY:-1}"
export MANGO_PLAYABILITY_PROBE_MS="${MANGO_PLAYABILITY_PROBE_MS:-6000}"

REFRESH_ARGS=(refresh --all --mode "$MODE")
if [[ -n "${MANGO_PLAYABILITY_CANDIDATE_LIMIT:-}" ]]; then
  REFRESH_ARGS+=(--candidate-limit "$MANGO_PLAYABILITY_CANDIDATE_LIMIT")
fi
if [[ "${MANGO_PLAYABILITY_BOOTSTRAP:-0}" == "1" ]]; then
  REFRESH_ARGS+=(--bootstrap)
  echo "bootstrap: pool_target=min_display, early-exit enabled"
fi

set +e
REFRESH_JSON="$(npm --prefix src/catalog-service exec tsx -- scripts/phase-n3c/playability-indexer.ts "${REFRESH_ARGS[@]}" 2>&1)"
REFRESH_RC=$?
set -e
echo "$REFRESH_JSON"

END_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
echo "maintenance refresh rc=$REFRESH_RC duration_ms=$((END_MS - START_MS))"

REFRESH_CRASHED=0
if [[ "$REFRESH_RC" -ne 0 ]] && ! echo "$REFRESH_JSON" | grep -q '"duration_ms"'; then
  REFRESH_CRASHED=1
fi

if [[ "$REFRESH_CRASHED" -eq 1 ]]; then
  echo "refresh crashed" >&2
  exit "$REFRESH_RC"
fi

if [[ "$REFRESH_RC" -ne 0 ]]; then
  if [[ "$ALLOW_PARTIAL" == "1" ]]; then
    echo "refresh partial — some rails below min_display (see JSON above)" >&2
  else
    echo "refresh failed" >&2
    exit "$REFRESH_RC"
  fi
fi

if [[ "$SKIP_GATE" != "1" && -x "$REPO_DIR/scripts/pi-pre-couch-gate.sh" ]]; then
  echo "running sampled pre-couch gate"
  MANGO_N3C_GATE_MAX_PER_RAIL="$GATE_SAMPLE" bash "$REPO_DIR/scripts/pi-pre-couch-gate.sh" || {
    echo "gate failed after maintenance — inspect playability status" >&2
    exit 1
  }
fi

trap - EXIT
restore_couch

echo "maintenance complete"
python3 "$REPO_DIR/scripts/diag/playability-status.py" --all 2>/dev/null | tail -20 || true
