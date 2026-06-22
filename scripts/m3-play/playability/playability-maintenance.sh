#!/usr/bin/env bash
# Dedicated maintenance: stop couch UI + catalog-service, refresh playability, restore stack.
#
# Usage:
#   bash scripts/m3-play/playability/playability-maintenance.sh [--mode grow|stale|nightly] [--bootstrap]
#
# Modes:
#   nightly — stale refresh all rails, then grow pass (default for Pi timer)
#   grow    — grow pass only (Library Grower inner loop)
#   stale   — re-probe stale titles only
#
# Deprecated aliases (warn once): full, growth → grow
#
# Env:
#   MANGO_MAINTENANCE_ALLOW_PARTIAL=1  exit 0 when refresh ran but pools below min_display (default 1)
#   MANGO_MAINTENANCE_SKIP_GATE=1      skip pi-pre-couch-gate after refresh (default 1 for grow/nightly)
#   MANGO_PLAYABILITY_BOOTSTRAP=1      target min_display per rail + early exit (set by --bootstrap)
#   MANGO_GROW_PRESET=nightly          preset wall/attempt limits for grow phase (default nightly)
#   MANGO_MAINTENANCE_PHASE_COOLDOWN_SEC  pause between stale and grow (default 45)

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

normalize_mode() {
  case "$1" in
    nightly|grow|stale) echo "$1" ;;
    full|growth)
      echo "playability-maintenance: mode '$1' deprecated — use grow or nightly" >&2
      echo grow
      ;;
    *)
      echo "mode must be grow, stale, or nightly (got: $1)" >&2
      exit 2
      ;;
  esac
}

MODE="$(normalize_mode "$MODE")"

if [[ -z "$SKIP_GATE" ]]; then
  SKIP_GATE=$([[ "$MODE" == "grow" || "$MODE" == "nightly" ]] && echo 1 || echo 0)
fi

mkdir -p "$CACHE_DIR"
OPS_DIR="${CACHE_DIR}/ops"
RUN_ID="playability-$(date +%Y%m%d-%H%M%S)"
export MANGO_OPS_RUN_ID="$RUN_ID"
export MANGO_OPS_SOURCE="playability-maintenance"
mkdir -p "$OPS_DIR"
MAINT_LOG="${OPS_DIR}/maintenance-${RUN_ID}.log"
exec > >(tee -a "$MAINT_LOG") 2>&1

# shellcheck source=../../lib/catalog-yaml.sh
source "$REPO_DIR/scripts/lib/catalog-yaml.sh"
export MANGO_CATALOG_YAML="$(resolve_catalog_yaml)" || exit 1
echo "catalog: $MANGO_CATALOG_YAML"

FILTERS_JSON="$(resolve_catalog_filters)"
if [[ -z "${MANGO_PLAYABILITY_PROBE_MS:-}" && -f "$FILTERS_JSON" ]]; then
  export MANGO_PLAYABILITY_PROBE_MS="$(
    python3 - "$FILTERS_JSON" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
print(int(data.get("auto_play_probe_ms") or 8000))
PY
  )"
fi
export MANGO_PLAYABILITY_PROBE_MS="${MANGO_PLAYABILITY_PROBE_MS:-8000}"
echo "probe_ms: $MANGO_PLAYABILITY_PROBE_MS (aligned with couch auto_play_probe_ms)"

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
  bash scripts/m3-play/playability/mpv-probe-pool.sh stop-all >/dev/null 2>&1 || true
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
  pkill -f 'chromium.*127.0.0.1:3000' >/dev/null 2>&1 || true
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
if [[ -z "${MANGO_PLAYABILITY_PROBE_CONCURRENCY:-}" && "${MANGO_MAINTENANCE_MODE:-0}" == "1" ]]; then
  export MANGO_PLAYABILITY_PROBE_CONCURRENCY=3
else
  export MANGO_PLAYABILITY_PROBE_CONCURRENCY="${MANGO_PLAYABILITY_PROBE_CONCURRENCY:-1}"
fi
export MANGO_PLAYABILITY_PROBE_MS="${MANGO_PLAYABILITY_PROBE_MS:-6000}"
export MANGO_GROW_PRESET="${MANGO_GROW_PRESET:-nightly}"
export MANGO_GROW_REQUIRE_TARGET="${MANGO_GROW_REQUIRE_TARGET:-1}"
export MANGO_GROW_SOURCE_RESET_CYCLES="${MANGO_GROW_SOURCE_RESET_CYCLES:-10}"
export MANGO_GROW_SOURCE_ADVANCE_PAGES="${MANGO_GROW_SOURCE_ADVANCE_PAGES:-25}"
export MANGO_PLAYABILITY_GROW_INGEST_BATCH="${MANGO_PLAYABILITY_GROW_INGEST_BATCH:-80}"
export MANGO_PLAYABILITY_MAX_INGEST_SCAN="${MANGO_PLAYABILITY_MAX_INGEST_SCAN:-2400}"
export MANGO_GROW_NO_STREAM_RETRY_MS="${MANGO_GROW_NO_STREAM_RETRY_MS:-21600000}"
PHASE_COOLDOWN_SEC="${MANGO_MAINTENANCE_PHASE_COOLDOWN_SEC:-45}"

run_refresh() {
  local refresh_mode="$1"
  local -a args=(refresh --all --mode "$refresh_mode")
  if [[ -n "${MANGO_PLAYABILITY_CANDIDATE_LIMIT:-}" ]]; then
    args+=(--candidate-limit "$MANGO_PLAYABILITY_CANDIDATE_LIMIT")
  fi
  if [[ "${MANGO_PLAYABILITY_BOOTSTRAP:-0}" == "1" ]]; then
    args+=(--bootstrap)
    echo "bootstrap: pool_target=min_display, early-exit enabled"
  fi
  npm --prefix src/catalog-service exec tsx -- scripts/m3-play/playability/playability-indexer.ts "${args[@]}"
}

REFRESH_JSON=""
REFRESH_RC=0

set +e
if [[ "$MODE" == "nightly" ]]; then
  echo "== phase 1: stale refresh =="
  STALE_JSON="$(run_refresh stale 2>&1)"
  STALE_RC=$?
  echo "$STALE_JSON"
  if [[ "$PHASE_COOLDOWN_SEC" -gt 0 ]]; then
    echo "phase cooldown: ${PHASE_COOLDOWN_SEC}s (AIOStreams stream rate-limit window)"
    sleep "$PHASE_COOLDOWN_SEC"
  fi
  echo "== phase 2: grow pass (preset=$MANGO_GROW_PRESET) =="
  REFRESH_JSON="$(run_refresh grow 2>&1)"
  REFRESH_RC=$?
  echo "$REFRESH_JSON"
  if [[ "$STALE_RC" -ne 0 && "$REFRESH_RC" -eq 0 ]]; then
    REFRESH_RC=$STALE_RC
  fi
else
  REFRESH_JSON="$(run_refresh "$MODE" 2>&1)"
  REFRESH_RC=$?
  echo "$REFRESH_JSON"
fi
set -e

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
  echo "running gate-lite after maintenance"
  bash "$REPO_DIR/scripts/gate-lite.sh" || {
    echo "gate failed after maintenance — inspect playability status" >&2
    exit 1
  }
fi

trap - EXIT
restore_couch

echo "maintenance complete"
python3 "$REPO_DIR/scripts/diag/playability-status.py" --all 2>/dev/null | tail -20 || true

REFRESH_OUT="${OPS_DIR}/refresh-${RUN_ID}.json"
if echo "$REFRESH_JSON" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  echo "$REFRESH_JSON" > "$REFRESH_OUT"
  python3 "$REPO_DIR/scripts/diag/ops-write-run.py" \
    --kind playability_maintenance \
    --run-id "$RUN_ID" \
    --source playability-maintenance \
    --write-report \
    --summary "maintenance mode=$MODE rc=$REFRESH_RC duration_ms=$((END_MS - START_MS))" \
    --payload-file "$REFRESH_OUT"
fi
