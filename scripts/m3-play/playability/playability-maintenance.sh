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
#   MANGO_GROW_PRESET=quick|nightly   preset for grow phase (default: quick for --mode grow, nightly for nightly)
#   MANGO_SOURCE_HITRATE_PREFLIGHT=1  refresh hit-rate before grow (default 1)
#   MANGO_SOURCE_HITRATE_QUICK_FRESH_HOURS=24  skip quick preflight when report newer (default 24)
#   MANGO_SOURCE_HITRATE_QUICK_PER_SOURCE=1    probes/source for quick grow preflight (default 1)
#   MANGO_SOURCE_HITRATE_NIGHTLY_PER_SOURCE=3  probes/source before nightly grow phase (default 3)
#   MANGO_MAINTENANCE_PHASE_COOLDOWN_SEC  pause between stale and grow (default 45)

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
LOCK_FILE="${CACHE_DIR}/playability-maintenance.lock"
MODE="${MANGO_PLAYABILITY_REFRESH_MODE:-stale}"
GATE_SAMPLE="${MANGO_N3C_GATE_MAX_PER_RAIL:-2}"
ALLOW_PARTIAL="${MANGO_MAINTENANCE_ALLOW_PARTIAL:-1}"
SKIP_GATE="${MANGO_MAINTENANCE_SKIP_GATE:-}"
ORIG_MANGO_PLAYABILITY_DB_SET=0
if [[ -n "${MANGO_PLAYABILITY_DB+x}" ]]; then
  ORIG_MANGO_PLAYABILITY_DB_SET=1
fi
LIVE_PLAYABILITY_DB="${MANGO_PLAYABILITY_DB:-/etc/mango/playability.db}"
WORK_PLAYABILITY_DB=""
STAGED_GROW_DB=0

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

if [[ "${MANGO_SKIP_AIOMETADATA_SYNC:-0}" != "1" ]]; then
  bash "$REPO_DIR/scripts/m4-addons/sync-aiometadata-rail-catalogs.sh" || {
    echo "warn: AIOMetadata rail catalog sync failed — grow may miss mdblist sources" >&2
  }
fi

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

resolve_grow_preset_early() {
  if [[ -z "${MANGO_GROW_PRESET:-}" ]]; then
    if [[ "$MODE" == "grow" ]]; then
      export MANGO_GROW_PRESET=quick
    else
      export MANGO_GROW_PRESET=nightly
    fi
  else
    export MANGO_GROW_PRESET="${MANGO_GROW_PRESET}"
  fi
}
resolve_grow_preset_early

grow_state() {
  python3 "$REPO_DIR/scripts/diag/grow_run_state.py" "$@"
}

# shellcheck source=../../lib/catalog-service-stack.sh
source "$REPO_DIR/scripts/lib/catalog-service-stack.sh"

set_live_playability_db_env() {
  if [[ "$ORIG_MANGO_PLAYABILITY_DB_SET" == "1" ]]; then
    export MANGO_PLAYABILITY_DB="$LIVE_PLAYABILITY_DB"
  else
    unset MANGO_PLAYABILITY_DB
  fi
}

sqlite_backup_db() {
  local src="$1"
  local dest="$2"
  python3 - "$src" "$dest" <<'PY'
import sqlite3
import sys
from pathlib import Path

src = Path(sys.argv[1])
dest = Path(sys.argv[2])
dest.parent.mkdir(parents=True, exist_ok=True)
for suffix in ("", "-wal", "-shm"):
    try:
        Path(str(dest) + suffix).unlink()
    except FileNotFoundError:
        pass
if not src.exists():
    sqlite3.connect(dest).close()
    raise SystemExit(0)
with sqlite3.connect(f"file:{src}?mode=ro", uri=True) as source:
    with sqlite3.connect(dest) as target:
        source.backup(target)
PY
}

sqlite_publish_db() {
  local src="$1"
  local dest="$2"
  python3 - "$src" "$dest" <<'PY'
import sqlite3
import sys
from pathlib import Path

src = Path(sys.argv[1])
dest = Path(sys.argv[2])
dest.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(src) as source:
    with sqlite3.connect(dest) as target:
        source.backup(target)
        target.execute("PRAGMA wal_checkpoint(TRUNCATE)")
for suffix in ("-wal", "-shm"):
    try:
        Path(str(dest) + suffix).unlink()
    except FileNotFoundError:
        pass
PY
}

sqlite_publish_cursor_rewinds() {
  local src="$1"
  local dest="$2"
  python3 - "$src" "$dest" <<'PY'
import sqlite3
import sys
from pathlib import Path

src = Path(sys.argv[1])
dest = Path(sys.argv[2])
if not src.exists() or not dest.exists():
    print("stage DB: cursor rewind sync skipped (missing DB)")
    raise SystemExit(0)

TABLES = {
    "rail_ingest_state": ("rail_id",),
    "rail_source_ingest_state": ("rail_id", "source_key"),
}

def table_exists(conn, schema, name):
    return conn.execute(
        f"SELECT 1 FROM {schema}.sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone() is not None

rewound = 0
with sqlite3.connect(dest, timeout=30) as live:
    live.row_factory = sqlite3.Row
    live.execute("PRAGMA busy_timeout=30000")
    live.execute("ATTACH DATABASE ? AS staged", (str(src),))
    for table, keys in TABLES.items():
        if not table_exists(live, "main", table) or not table_exists(live, "staged", table):
            continue
        key_select = ", ".join(keys)
        staged_rows = live.execute(
            f"SELECT {key_select}, catalog_offset, updated_at FROM staged.{table}"
        ).fetchall()
        for row in staged_rows:
            where = " AND ".join(f"{key}=?" for key in keys)
            params = tuple(row[key] for key in keys)
            current = live.execute(
                f"SELECT catalog_offset FROM {table} WHERE {where}",
                params,
            ).fetchone()
            staged_offset = int(row["catalog_offset"] or 0)
            if current is not None and staged_offset >= int(current["catalog_offset"] or 0):
                continue
            columns = [*keys, "catalog_offset", "updated_at"]
            placeholders = ", ".join("?" for _ in columns)
            updates = "catalog_offset=excluded.catalog_offset, updated_at=excluded.updated_at"
            live.execute(
                f"""
INSERT INTO {table} ({", ".join(columns)})
VALUES ({placeholders})
ON CONFLICT({", ".join(keys)}) DO UPDATE SET {updates}
""",
                (*params, staged_offset, int(row["updated_at"] or 0)),
            )
            rewound += 1
    live.commit()
    live.execute("PRAGMA wal_checkpoint(TRUNCATE)")
print(f"stage DB: synced {rewound} cursor rewind(s) to live DB")
PY
}

cleanup_work_playability_db() {
  if [[ -n "$WORK_PLAYABILITY_DB" ]]; then
    rm -f "$WORK_PLAYABILITY_DB" "$WORK_PLAYABILITY_DB-wal" "$WORK_PLAYABILITY_DB-shm"
  fi
}

stage_playability_db_if_needed() {
  if [[ "$MODE" != "grow" && "$MODE" != "nightly" ]]; then
    return 0
  fi
  if [[ "${MANGO_GROW_STAGE_DB:-1}" != "1" ]]; then
    echo "grow DB staging disabled (MANGO_GROW_STAGE_DB=0)"
    return 0
  fi
  STAGED_GROW_DB=1
  WORK_PLAYABILITY_DB="${CACHE_DIR}/playability-work-${RUN_ID}.db"
  grow_state set --phase stage --message "staging playability DB" \
    --mode "$MODE" --preset "$MANGO_GROW_PRESET" \
    --log "stage DB: live=$LIVE_PLAYABILITY_DB work=$WORK_PLAYABILITY_DB"
  echo "stage DB: live=$LIVE_PLAYABILITY_DB work=$WORK_PLAYABILITY_DB"
  sqlite_backup_db "$LIVE_PLAYABILITY_DB" "$WORK_PLAYABILITY_DB"
  export MANGO_PLAYABILITY_DB="$WORK_PLAYABILITY_DB"
}

refresh_json_ok() {
  local path="$1"
  python3 - "$path" <<'PY'
import json
import sys
from pathlib import Path

try:
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
except Exception:
    print("0")
    raise SystemExit(0)
print("1" if payload.get("ok") is True else "0")
PY
}

publish_or_discard_staged_db() {
  if [[ "$STAGED_GROW_DB" != "1" ]]; then
    return 0
  fi
  local json_ok="0"
  if [[ "$REFRESH_OUT_WRITTEN" == "1" && -f "$REFRESH_OUT" ]]; then
    json_ok="$(refresh_json_ok "$REFRESH_OUT")"
  fi
  set_live_playability_db_env
  if [[ "$REFRESH_RC" -eq 0 && "$json_ok" == "1" ]]; then
    echo "stage DB: publishing strict successful grow to $LIVE_PLAYABILITY_DB"
    sqlite_publish_db "$WORK_PLAYABILITY_DB" "$LIVE_PLAYABILITY_DB"
    grow_state log "stage DB: published strict successful grow"
  else
    sqlite_publish_cursor_rewinds "$WORK_PLAYABILITY_DB" "$LIVE_PLAYABILITY_DB" || true
    echo "stage DB: discarding failed or partial grow DB; live library unchanged"
    grow_state log "stage DB: discarded failed or partial grow DB"
  fi
  cleanup_work_playability_db
}

run_source_hitrate_preflight() {
  local preset="$1"
  local force="${2:-0}"
  local -a force_args=()
  if [[ "$force" == "1" ]]; then
    force_args+=(--force)
  fi

  if [[ "${MANGO_SOURCE_HITRATE_PREFLIGHT:-1}" != "1" ]]; then
    grow_state set --phase preflight --message "hit-rate preflight disabled" \
      --mode "$MODE" --preset "$preset" \
      --log "source-hitrate preflight: skipped (MANGO_SOURCE_HITRATE_PREFLIGHT=0)"
    echo "source-hitrate preflight: skipped (MANGO_SOURCE_HITRATE_PREFLIGHT=0)"
    return 0
  fi
  if ! curl -sf --max-time 2 http://127.0.0.1:3020/health >/dev/null 2>&1; then
    grow_state set --phase preflight --message "catalog down — using cached report" \
      --mode "$MODE" --preset "$preset" \
      --log "source-hitrate preflight: catalog down — using cached report if present"
    echo "source-hitrate preflight: catalog down — using cached report if present"
    return 0
  fi

  local plan_json decision reason per_source source_total
  plan_json="$(python3 "$REPO_DIR/scripts/diag/source_hitrate_preflight.py" plan --preset "$preset" "${force_args[@]}")"
  decision="$(python3 -c "import json,sys; print(json.load(sys.stdin)['decision'])" <<<"$plan_json")"
  reason="$(python3 -c "import json,sys; print(json.load(sys.stdin)['reason'])" <<<"$plan_json")"
  per_source="$(python3 -c "import json,sys; print(json.load(sys.stdin)['per_source'])" <<<"$plan_json")"
  source_total="$(python3 -c "import json,sys; print(json.load(sys.stdin).get('source_total') or 0)" <<<"$plan_json")"

  if [[ "$decision" == "skip" ]]; then
    grow_state set --phase preflight --message "using cached hit-rate ($reason)" \
      --mode "$MODE" --preset "$preset" \
      --log "source-hitrate preflight: skipped ($reason)"
    echo "source-hitrate preflight: skipped ($reason)"
    return 0
  fi

  grow_state set --phase preflight \
    --message "probing sources (per_source=$per_source)" \
    --mode "$MODE" --preset "$preset" \
    --preflight-done 0 --preflight-total "$source_total" \
    --log "source-hitrate preflight: start preset=$preset per_source=$per_source ($reason)"

  echo "source-hitrate preflight: preset=$preset per_source=$per_source ($reason)"
  export MANGO_GROW_RUN_STATE=1
  if [[ "${MANGO_GROW_LOG_WRAPPED:-0}" == "1" ]]; then
    PYTHONUNBUFFERED=1 \
      MANGO_SOURCE_HITRATE_PER_SOURCE="$per_source" \
      python3 "$REPO_DIR/scripts/diag/source-hitrate.py" 2>&1 \
      || true
  else
    PYTHONUNBUFFERED=1 \
      MANGO_SOURCE_HITRATE_PER_SOURCE="$per_source" \
      python3 "$REPO_DIR/scripts/diag/source-hitrate.py" 2>&1 \
      | tee -a "${CACHE_DIR}/playability-grow.log" \
      || true
  fi
  unset MANGO_GROW_RUN_STATE

  grow_state set --phase preflight --message "hit-rate report written" \
    --mode "$MODE" --preset "$preset" \
    --log "source-hitrate preflight: complete"
}

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "another maintenance run is in progress ($LOCK_FILE)" >&2
  exit 2
fi
LOCK_RELEASED=0

cd "$REPO_DIR"

preflight_native_deps() {
  if ! node -e "require('./src/catalog-service/node_modules/better-sqlite3')" >/dev/null 2>&1; then
    echo "rebuilding better-sqlite3 for this platform"
    npm rebuild better-sqlite3 --prefix src/catalog-service
  fi
}
preflight_native_deps

release_maintenance_lock() {
  if [[ "${LOCK_RELEASED:-1}" == "1" ]]; then
    return 0
  fi
  flock -u 200 >/dev/null 2>&1 || true
  exec 200>&- || true
  LOCK_RELEASED=1
}

restore_couch() {
  release_maintenance_lock
  set_live_playability_db_env
  bash scripts/m3-play/playability/mpv-probe-pool.sh stop-all >/dev/null 2>&1 || true
  bash scripts/mango-kill-strays.sh >/dev/null 2>&1 || true
  MANGO_CATALOG=1 MANGO_PLAYABILITY_TOPUP_ON_START=0 bash scripts/mango-refresh.sh >/dev/null 2>&1 \
    || echo "warn: mango-refresh failed — run manually" >&2
  cleanup_work_playability_db
}

trap restore_couch EXIT

echo "== mango playability maintenance (mode=$MODE preset=$MANGO_GROW_PRESET) =="
grow_state set --phase init \
  --message "maintenance starting" \
  --mode "$MODE" --preset "$MANGO_GROW_PRESET" --run-id "$RUN_ID" \
  --log "playability-maintenance: mode=$MODE preset=$MANGO_GROW_PRESET"

write_grow_baseline_if_needed() {
  if [[ "$1" == "grow" ]]; then
    echo "grow baseline snapshot"
    python3 "$REPO_DIR/scripts/diag/grow_monitor.py" baseline
  fi
}

if pgrep -f 'chromium.*127.0.0.1:3000|firefox.*127.0.0.1:3000' >/dev/null 2>&1; then
  echo "stopping launcher browser"
  pkill -f 'chromium.*127.0.0.1:3000' >/dev/null 2>&1 || true
  pkill -f 'firefox.*127.0.0.1:3000' >/dev/null 2>&1 || true
  sleep 1
fi

if curl -sf --max-time 2 http://127.0.0.1:3020/health >/dev/null 2>&1; then
  if [[ "$MODE" == "grow" ]]; then
    run_source_hitrate_preflight quick 0
  fi
  echo "stopping catalog-service (exclusive indexer)"
  stop_catalog_service_only
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
export MANGO_GROW_HITRATE_WEIGHTS="${MANGO_GROW_HITRATE_WEIGHTS:-1}"
export MANGO_GROW_REQUIRE_TARGET="${MANGO_GROW_REQUIRE_TARGET:-1}"
export MANGO_GROW_SOURCE_RESET_CYCLES="${MANGO_GROW_SOURCE_RESET_CYCLES:-10}"
export MANGO_GROW_SOURCE_ADVANCE_PAGES="${MANGO_GROW_SOURCE_ADVANCE_PAGES:-25}"
export MANGO_PLAYABILITY_GROW_INGEST_BATCH="${MANGO_PLAYABILITY_GROW_INGEST_BATCH:-80}"
export MANGO_PLAYABILITY_MAX_INGEST_SCAN="${MANGO_PLAYABILITY_MAX_INGEST_SCAN:-2400}"
export MANGO_GROW_NO_STREAM_RETRY_MS="${MANGO_GROW_NO_STREAM_RETRY_MS:-604800000}"
PHASE_COOLDOWN_SEC="${MANGO_MAINTENANCE_PHASE_COOLDOWN_SEC:-45}"

stage_playability_db_if_needed

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
  grow_state set --phase stale --message "stale refresh in progress" --mode "$MODE" --preset "$MANGO_GROW_PRESET"
  echo "== phase 1: stale refresh =="
  STALE_JSON="$(run_refresh stale 2>&1)"
  STALE_RC=$?
  echo "$STALE_JSON"
  if [[ "$PHASE_COOLDOWN_SEC" -gt 0 ]]; then
    grow_state set --phase cooldown \
      --message "phase cooldown ${PHASE_COOLDOWN_SEC}s (stream rate-limit window)" \
      --mode "$MODE" --preset "$MANGO_GROW_PRESET"
    echo "phase cooldown: ${PHASE_COOLDOWN_SEC}s (AIOStreams stream rate-limit window)"
    sleep "$PHASE_COOLDOWN_SEC"
  fi
  echo "== phase 2: grow pass (preset=$MANGO_GROW_PRESET) =="
  grow_state set --phase preflight \
    --message "starting catalog for nightly hit-rate preflight" \
    --mode "$MODE" --preset "$MANGO_GROW_PRESET" \
    --log "nightly grow: hit-rate preflight before grow phase"
  MANGO_CATALOG=1 start_catalog_service_only \
    || grow_state log "warn: catalog start for hitrate failed — using cached report"
  run_source_hitrate_preflight nightly "${MANGO_SOURCE_HITRATE_FORCE:-0}"
  stop_catalog_service_only
  write_grow_baseline_if_needed grow
  grow_state set --phase grow --message "grow refresh in progress" --mode "$MODE" --preset "$MANGO_GROW_PRESET"
  REFRESH_JSON="$(run_refresh grow 2>&1)"
  REFRESH_RC=$?
  echo "$REFRESH_JSON"
  if [[ "$STALE_RC" -ne 0 && "$REFRESH_RC" -eq 0 ]]; then
    REFRESH_RC=$STALE_RC
  fi
else
  if [[ "$MODE" == "grow" ]]; then
    grow_state set --phase grow --message "grow refresh in progress" --mode "$MODE" --preset "$MANGO_GROW_PRESET"
  elif [[ "$MODE" == "stale" ]]; then
    grow_state set --phase stale --message "stale refresh in progress" --mode "$MODE" --preset "$MANGO_GROW_PRESET"
  fi
  write_grow_baseline_if_needed "$MODE"
  REFRESH_JSON="$(run_refresh "$MODE" 2>&1)"
  REFRESH_RC=$?
  echo "$REFRESH_JSON"
fi
set -e

END_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
echo "maintenance refresh rc=$REFRESH_RC duration_ms=$((END_MS - START_MS))"

REFRESH_OUT="${OPS_DIR}/refresh-${RUN_ID}.json"
REFRESH_OUT_WRITTEN=0
if echo "$REFRESH_JSON" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  echo "$REFRESH_JSON" > "$REFRESH_OUT"
  REFRESH_OUT_WRITTEN=1
  python3 "$REPO_DIR/scripts/diag/ops-write-run.py" \
    --kind playability_maintenance \
    --run-id "$RUN_ID" \
    --source playability-maintenance \
    --write-report \
    --summary "maintenance mode=$MODE rc=$REFRESH_RC duration_ms=$((END_MS - START_MS))" \
    --payload-file "$REFRESH_OUT"
fi

REFRESH_CRASHED=0
if [[ "$REFRESH_RC" -ne 0 ]] && ! echo "$REFRESH_JSON" | grep -q '"duration_ms"'; then
  REFRESH_CRASHED=1
fi

publish_or_discard_staged_db

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
grow_state set --phase restore --message "restoring couch stack" --mode "$MODE" --preset "$MANGO_GROW_PRESET"
restore_couch

echo "maintenance complete"
grow_state set --phase done --message "complete rc=$REFRESH_RC" --mode "$MODE" --preset "$MANGO_GROW_PRESET" \
  --log "maintenance complete mode=$MODE rc=$REFRESH_RC duration_ms=$((END_MS - START_MS))"
python3 "$REPO_DIR/scripts/diag/grow_monitor.py" status 2>/dev/null || true
python3 "$REPO_DIR/scripts/diag/playability-status.py" 2>/dev/null | tail -20 || true
if [[ "$MODE" == "grow" || "$MODE" == "nightly" ]] && [[ "$REFRESH_OUT_WRITTEN" == "1" ]]; then
  python3 "$REPO_DIR/scripts/diag/grow_monitor.py" assess --refresh-json "$REFRESH_OUT" 2>/dev/null || true
fi
