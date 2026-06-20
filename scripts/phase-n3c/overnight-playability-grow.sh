#!/usr/bin/env bash
# Overnight additive playability growth (Option C). Survives SSH disconnect via --detach.
#
# Each chunk = one full indexer refresh (+pool_growth_per_refresh per rail, additive only).
# Couch stays down for the whole run; stack is restored on exit (normal or interrupt).
#
# Usage:
#   bash scripts/phase-n3c/overnight-playability-grow.sh --detach   # start on Pi, go to sleep
#   bash scripts/phase-n3c/overnight-playability-grow.sh --status   # tail progress
#   bash scripts/phase-n3c/overnight-playability-grow.sh            # foreground (debug)
#
# Env:
#   MANGO_OVERNIGHT_TARGET           verified count goal per rail (default 90)
#   MANGO_OVERNIGHT_DURATION_SEC     max runtime (default 14400 = 4h)
#   MANGO_OVERNIGHT_CHUNK_PAUSE_SEC  pause between chunks (default 90)
#   MANGO_PLAYABILITY_RESOLVE_CONCURRENCY  default 8
#   MANGO_PLAYABILITY_PROBE_CONCURRENCY    default 3
#   MANGO_PLAYABILITY_CANDIDATE_LIMIT      default 250

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
LOG="${CACHE_DIR}/overnight-fill.log"
LOCK="${CACHE_DIR}/overnight-fill.lock"
PIDFILE="${CACHE_DIR}/overnight-fill.pid"

TARGET_VERIFIED="${MANGO_OVERNIGHT_TARGET:-90}"
DURATION_SEC="${MANGO_OVERNIGHT_DURATION_SEC:-14400}"
CHUNK_PAUSE_SEC="${MANGO_OVERNIGHT_CHUNK_PAUSE_SEC:-90}"

log() {
  printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"
}

usage() {
  cat <<EOF
usage:
  $0 --detach    start in background (nohup); safe if SSH drops
  $0 --status    show pid + recent log
  $0             run in foreground
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "--status" ]]; then
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "running pid=$(cat "$PIDFILE")"
  else
    echo "not running"
  fi
  echo "log: $LOG"
  if [[ -f "$LOG" ]]; then
    echo "--- last 40 lines ---"
    tail -40 "$LOG"
  fi
  exit 0
fi

if [[ "${1:-}" == "--detach" ]]; then
  mkdir -p "$CACHE_DIR"
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "already running pid=$(cat "$PIDFILE") log=$LOG"
    exit 0
  fi
  nohup env MANGO_REPO_DIR="$REPO_DIR" bash "$0" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  disown -h 2>/dev/null || true
  echo "started pid=$(cat "$PIDFILE") log=$LOG"
  echo "check: bash $0 --status"
  exit 0
fi

mkdir -p "$CACHE_DIR"
touch "$LOG"

exec 200>"$LOCK"
if ! flock -n 200; then
  echo "overnight fill already running (lock $LOCK)" >&2
  exit 2
fi

echo $$ >"$PIDFILE"

# shellcheck source=../lib/catalog-yaml.sh
source "$REPO_DIR/scripts/lib/catalog-yaml.sh"
export MANGO_CATALOG_YAML="$(resolve_catalog_yaml)" || exit 1

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

export MANGO_MAINTENANCE_MODE=1
export MANGO_MAINTENANCE_SKIP_GATE=1
export MANGO_PLAYABILITY_BOOTSTRAP=0
export MANGO_PLAYABILITY_EARLY_EXIT_MIN_DISPLAY=0
export MANGO_PLAYABILITY_PROBE_POOL=1
export MANGO_PLAYABILITY_BATCH_DB=1
export MANGO_PLAYABILITY_RESOLVE_CONCURRENCY="${MANGO_PLAYABILITY_RESOLVE_CONCURRENCY:-8}"
export MANGO_PLAYABILITY_PROBE_CONCURRENCY="${MANGO_PLAYABILITY_PROBE_CONCURRENCY:-3}"
export MANGO_PLAYABILITY_PROBE_MS="${MANGO_PLAYABILITY_PROBE_MS:-6000}"
export MANGO_PLAYABILITY_CANDIDATE_LIMIT="${MANGO_PLAYABILITY_CANDIDATE_LIMIT:-250}"

restore_couch() {
  log "restoring couch stack"
  bash "$REPO_DIR/scripts/phase-n3c/mpv-probe-pool.sh" stop-all >/dev/null 2>&1 || true
  bash "$REPO_DIR/scripts/mango-kill-strays.sh" >/dev/null 2>&1 || true
  MANGO_CATALOG=1 MANGO_PLAYABILITY_TOPUP_ON_START=0 \
    bash "$REPO_DIR/scripts/mango-refresh.sh" >>"$LOG" 2>&1 || log "warn: mango-refresh failed"
}

stop_couch_for_indexer() {
  if pgrep -f 'chromium.*127.0.0.1:3000' >/dev/null 2>&1; then
    log "stopping chromium"
    pkill -f 'chromium.*127.0.0.1:3000' 2>/dev/null || true
    sleep 1
  fi
  if curl -sf --max-time 2 http://127.0.0.1:3020/health >/dev/null 2>&1; then
    log "stopping catalog-service"
    local pid_file="${CACHE_DIR}/catalog-service.pid"
    if [[ -f "$pid_file" ]]; then
      kill "$(cat "$pid_file")" 2>/dev/null || true
      sleep 0.3
      kill -9 "$(cat "$pid_file")" 2>/dev/null || true
      rm -f "$pid_file"
    fi
    pkill -f '[c]atalog-service/dist/index.js' 2>/dev/null || true
    sleep 0.5
  fi
}

on_exit() {
  restore_couch
  rm -f "$PIDFILE"
  log "overnight fill exit"
}

trap on_exit EXIT INT TERM

rails_below_target() {
  MANGO_REPO_DIR="$REPO_DIR" \
  MANGO_CATALOG_YAML="$MANGO_CATALOG_YAML" \
  MANGO_OVERNIGHT_TARGET="$TARGET_VERIFIED" \
  python3 - <<'PY'
import os
import sqlite3
import time
from pathlib import Path

import yaml

catalog = Path(os.environ["MANGO_CATALOG_YAML"])
target = int(os.environ["MANGO_OVERNIGHT_TARGET"])
now_ms = int(time.time() * 1000)

data = yaml.safe_load(catalog.read_text(encoding="utf-8"))
rail_ids = [
    rail["id"]
    for rail in data.get("rails") or []
    if rail.get("enabled", True) is not False
    and rail.get("type") in ("addon_catalog", "composite_list")
]

db = sqlite3.connect("/etc/mango/playability.db")
below = []
for rail_id in rail_ids:
    row = db.execute(
        """
        SELECT COUNT(*) FROM rail_pool rp
        JOIN titles t ON t.type = rp.type AND t.id = rp.id
        WHERE rp.rail_id = ?
          AND t.status = 'verified'
          AND (t.expires_at IS NULL OR t.expires_at > ?)
        """,
        (rail_id, now_ms),
    ).fetchone()
    verified = int(row[0] if row else 0)
    if verified < target:
        below.append((rail_id, verified))

print(len(below))
for rail_id, verified in sorted(below, key=lambda item: item[1]):
    print(f"{rail_id}\t{verified}")
PY
}

print_pool_summary() {
  MANGO_REPO_DIR="$REPO_DIR" \
  MANGO_CATALOG_YAML="$MANGO_CATALOG_YAML" \
  MANGO_OVERNIGHT_TARGET="$TARGET_VERIFIED" \
  python3 - <<'PY'
import os
import sqlite3
import time
from pathlib import Path

import yaml

catalog = Path(os.environ["MANGO_CATALOG_YAML"])
target = int(os.environ["MANGO_OVERNIGHT_TARGET"])
now_ms = int(time.time() * 1000)

data = yaml.safe_load(catalog.read_text(encoding="utf-8"))
rail_ids = [
    rail["id"]
    for rail in data.get("rails") or []
    if rail.get("enabled", True) is not False
    and rail.get("type") in ("addon_catalog", "composite_list")
]

db = sqlite3.connect("/etc/mango/playability.db")
rows = []
for rail_id in rail_ids:
    row = db.execute(
        """
        SELECT COUNT(*) FROM rail_pool rp
        JOIN titles t ON t.type = rp.type AND t.id = rp.id
        WHERE rp.rail_id = ?
          AND t.status = 'verified'
          AND (t.expires_at IS NULL OR t.expires_at > ?)
        """,
        (rail_id, now_ms),
    ).fetchone()
    verified = int(row[0] if row else 0)
    rows.append((rail_id, verified))

total = sum(v for _, v in rows)
min_v = min((v for _, v in rows), default=0)
max_v = max((v for _, v in rows), default=0)
at_target = sum(1 for _, v in rows if v >= target)
print(f"summary target={target} rails={len(rows)} at_target={at_target} total_verified={total} min={min_v} max={max_v}")
for rail_id, verified in rows:
    mark = "ok" if verified >= target else "grow"
    print(f"  {rail_id:28} {verified:4d} [{mark}]")
PY
}

preflight() {
  log "preflight commit=$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  log "target=$TARGET_VERIFIED per rail duration_sec=$DURATION_SEC chunk_pause=$CHUNK_PAUSE_SEC"
  log "resolve_concurrency=$MANGO_PLAYABILITY_RESOLVE_CONCURRENCY probe_concurrency=$MANGO_PLAYABILITY_PROBE_CONCURRENCY"

  if ! node -e "require('$REPO_DIR/src/catalog-service/node_modules/better-sqlite3')" >/dev/null 2>&1; then
    log "rebuilding better-sqlite3"
    npm rebuild better-sqlite3 --prefix "$REPO_DIR/src/catalog-service"
  fi

  curl -sf --max-time 10 "http://127.0.0.1:3035/api/v1/status" >/dev/null \
    || { log "FAIL AIOStreams :3035"; exit 1; }
  log "OK AIOStreams"

  # shellcheck source=../phase-n3d/lib/aiometadata.sh
  source "$REPO_DIR/scripts/phase-n3d/lib/aiometadata.sh"
  if ! aiometadata_health_ok; then
    log "FAIL AIOMetadata ($(aiometadata_health_url))"
    exit 1
  fi
  log "OK AIOMetadata"

  if [[ ! -f /etc/mango/playability.db ]]; then
    log "FAIL missing /etc/mango/playability.db"
    exit 1
  fi
  log "OK playability.db"
}

summarize_chunk_json() {
  local chunk="$1"
  local rc="$2"
  local json_file="$3"
  CHUNK="$chunk" RC="$rc" JSON_FILE="$json_file" python3 - <<'PY'
import json
import os
import sys

chunk = os.environ["CHUNK"]
rc = int(os.environ["RC"])
path = os.environ["JSON_FILE"]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception as exc:
    print(f"chunk {chunk} rc={rc} parse_error={exc}")
    sys.exit(0)

verified = data.get("verified", "?")
failed = data.get("failed", "?")
duration_ms = data.get("duration_ms", "?")
ingest_fresh = data.get("ingest_fresh_queued", "?")
ingest_scanned = data.get("ingest_scanned", "?")
rails = data.get("rails") or []
gained = sum(
    int((r.get("after") or {}).get("verified_pool") or 0)
    - int((r.get("before") or {}).get("verified_pool") or 0)
    for r in rails
)
print(f"chunk {chunk} rc={rc} duration_ms={duration_ms} ingest_fresh={ingest_fresh} ingest_scanned={ingest_scanned} verified_new={verified} failed={failed} rail_slots_gained={gained}")
for rail in rails:
    before = int((rail.get("before") or {}).get("verified_pool") or 0)
    after = int((rail.get("after") or {}).get("verified_pool") or 0)
    if after != before or int(rail.get("verified") or 0) > 0:
        print(f"  {rail.get('rail_id')}: {before} -> {after} (+{after - before}) new_probes={rail.get('verified')}")
PY
}

rail_slots_gained() {
  local json_file="$1"
  JSON_FILE="$json_file" python3 - <<'PY'
import json
import os
data = json.load(open(os.environ["JSON_FILE"], encoding="utf-8"))
rails = data.get("rails") or []
print(sum(
    int((r.get("after") or {}).get("verified_pool") or 0)
    - int((r.get("before") or {}).get("verified_pool") or 0)
    for r in rails
))
PY
}

run_chunk() {
  local chunk="$1"
  local json_file="${CACHE_DIR}/overnight-chunk-${chunk}.json"
  local err_file="${CACHE_DIR}/overnight-chunk-${chunk}.err"

  set +e
  npm --prefix "$REPO_DIR/src/catalog-service" exec tsx -- \
    "$REPO_DIR/scripts/phase-n3c/playability-indexer.ts" \
    refresh --all --mode full \
    >"$json_file" 2>"$err_file"
  local rc=$?
  set -e

  if [[ ! -s "$json_file" ]]; then
    log "chunk $chunk indexer produced no JSON (rc=$rc)"
    if [[ -s "$err_file" ]]; then
      tail -5 "$err_file" | while read -r line; do log "  err: $line"; done
    fi
    echo 0
    return 0
  fi

  summarize_chunk_json "$chunk" "$rc" "$json_file" | while read -r line; do log "$line"; done
  if [[ -s "$err_file" ]]; then
    tail -3 "$err_file" | while read -r line; do log "  stderr: $line"; done
  fi
  rail_slots_gained "$json_file"
}

cd "$REPO_DIR"
log "=== overnight playability grow start ==="
print_pool_summary | while read -r line; do log "$line"; done

preflight
stop_couch_for_indexer

END_TS=$(( $(date +%s) + DURATION_SEC ))
CHUNK=0
STALL_CHUNKS=0

while [[ $(date +%s) -lt $END_TS ]]; do
  BELOW_RAW="$(rails_below_target)"
  BELOW_COUNT="$(echo "$BELOW_RAW" | head -1)"
  if [[ "${BELOW_COUNT:-0}" -eq 0 ]]; then
    log "all browse rails at or above target $TARGET_VERIFIED"
    break
  fi

  CHUNK=$((CHUNK + 1))
  log "chunk $CHUNK start rails_below_target=$BELOW_COUNT"
  echo "$BELOW_RAW" | tail -n +2 | head -5 | while read -r line; do log "  thin: $line"; done

  GAINED="$(run_chunk "$CHUNK")"
  INGEST_FRESH="$(python3 - "$CACHE_DIR/overnight-chunk-${CHUNK}.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
print(int(data.get("ingest_fresh_queued") or 0))
PY
)"
  print_pool_summary | while read -r line; do log "$line"; done

  if [[ "${GAINED:-0}" -eq 0 && "${INGEST_FRESH:-0}" -eq 0 ]]; then
    STALL_CHUNKS=$((STALL_CHUNKS + 1))
    log "warn chunk $CHUNK gained 0 rail slots and queued 0 fresh candidates (stall $STALL_CHUNKS/3)"
    if [[ "$STALL_CHUNKS" -ge 3 ]]; then
      log "stopping: no growth in 3 consecutive chunks"
      break
    fi
  else
    STALL_CHUNKS=0
  fi

  REMAIN=$(( END_TS - $(date +%s) ))
  if [[ "$REMAIN" -le 0 ]]; then
    break
  fi
  log "chunk $CHUNK done sleeping ${CHUNK_PAUSE_SEC}s (${REMAIN}s remaining)"
  sleep "$CHUNK_PAUSE_SEC"
done

log "=== overnight playability grow complete chunks=$CHUNK ==="
print_pool_summary | while read -r line; do log "$line"; done

exit 0
