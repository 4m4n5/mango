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
#   MANGO_SOURCE_HITRATE_PREFLIGHT=1  explicit isolated source benchmark (default 0)
#   MANGO_SOURCE_HITRATE_QUICK_FRESH_HOURS=24  skip quick preflight when report newer (default 24)
#   MANGO_SOURCE_HITRATE_QUICK_PER_SOURCE=1    probes/source for quick grow preflight (default 1)
#   MANGO_SOURCE_HITRATE_NIGHTLY_PER_SOURCE=3  probes/source before nightly grow phase (default 3)
#   MANGO_MAINTENANCE_PHASE_COOLDOWN_SEC  pause between stale and grow (default 45)
#   MANGO_MAINTENANCE_IGNORE_COUCH_ACTIVITY=1  debug/operator override for idle gate
#   MANGO_VOD_RECOMMENDATION_REFRESH_TIMEOUT_SEC  wait for exact queued VOD jobs (default 900)

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
PUBLICATION_ID=""
PUBLICATION_SNAPSHOT=""
PUBLICATION_RECEIPT=""
PUBLISHED_STAGED_DB=0

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

# Direct/familiar invocations enter the same coordinator before catalog sync,
# provider work, or any database mutation. Coordinator-owned children carry the
# inherited fd and continue below without a second admission decision.
if [[ "${MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD:-0}" != "1" ]]; then
  delegate_args=(--mode "$MODE")
  if [[ -n "${MANGO_GROW_PRESET:-}" ]]; then
    delegate_args+=(--preset "$MANGO_GROW_PRESET")
  fi
  exec bash "$REPO_DIR/scripts/m3-play/playability/playability-grow.sh" "${delegate_args[@]}"
fi

if [[ -z "$SKIP_GATE" ]]; then
  SKIP_GATE=$([[ "$MODE" == "grow" || "$MODE" == "nightly" ]] && echo 1 || echo 0)
fi

mkdir -p "$CACHE_DIR"
OPS_DIR="${CACHE_DIR}/ops"
RUN_ID="${MANGO_PLAYABILITY_RUN_ID:-playability-$(date +%Y%m%d-%H%M%S)}"
export MANGO_OPS_RUN_ID="$RUN_ID"
export MANGO_OPS_SOURCE="playability-maintenance"
RUN_STARTED_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
NIGHTLY_DEADLINE_MINUTES="${MANGO_PLAYABILITY_NIGHTLY_DEADLINE_MINUTES:-150}"
ADMISSION_STOP_MINUTES="${MANGO_PLAYABILITY_ADMISSION_STOP_MINUTES:-135}"
if [[ ! "$NIGHTLY_DEADLINE_MINUTES" =~ ^[0-9]+$ ]] || [[ "$NIGHTLY_DEADLINE_MINUTES" -lt 30 ]]; then
  NIGHTLY_DEADLINE_MINUTES=150
fi
if [[ ! "$ADMISSION_STOP_MINUTES" =~ ^[0-9]+$ ]] \
    || [[ "$ADMISSION_STOP_MINUTES" -lt 1 ]] \
    || [[ "$ADMISSION_STOP_MINUTES" -ge "$NIGHTLY_DEADLINE_MINUTES" ]]; then
  ADMISSION_STOP_MINUTES=$((NIGHTLY_DEADLINE_MINUTES - 15))
fi
export MANGO_PLAYABILITY_RUN_DEADLINE_MS=$((RUN_STARTED_MS + NIGHTLY_DEADLINE_MINUTES * 60 * 1000))
export MANGO_PLAYABILITY_ADMISSION_DEADLINE_MS=$((RUN_STARTED_MS + ADMISSION_STOP_MINUTES * 60 * 1000))
if [[ "$MANGO_GROW_PRESET" == "quick" ]]; then
  # The quick preset is an operator-facing whole-run budget, not eight minutes
  # independently for every rail. Stop admitting work at the advertised bound;
  # publication and couch restoration may finish immediately afterward.
  export MANGO_PLAYABILITY_ADMISSION_DEADLINE_MS=$((RUN_STARTED_MS + 8 * 60 * 1000))
fi
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

couch_activity_status() {
  bash "$REPO_DIR/scripts/lib/couch-activity.sh" status 2>/dev/null \
    || printf '{"ok":true,"idle":true,"age_sec":999999999,"source":"unknown","hint":""}\n'
}

couch_is_idle() {
  [[ "${MANGO_MAINTENANCE_IGNORE_COUCH_ACTIVITY:-0}" == "1" ]] && return 0
  bash "$REPO_DIR/scripts/lib/couch-activity.sh" is-idle >/dev/null 2>&1
}

write_deferred_report() {
  local phase="$1"
  local status_json payload
  status_json="$(couch_activity_status)"
  payload="${OPS_DIR}/refresh-${RUN_ID}-deferred.json"
  python3 - "$payload" "$MODE" "$MANGO_GROW_PRESET" "$RUN_ID" "$phase" "$status_json" <<'PY'
import json
import sys
from datetime import datetime, timezone

path, mode, preset, run_id, phase, status_raw = sys.argv[1:]
activity = json.loads(status_raw)
partial = phase not in {"initial", "pre_stop_launcher"}
payload = {
    "ok": False,
    "run_id": run_id,
    "mode": mode,
    "preset": preset,
    "stage": phase,
    "failure_category": "couch_active_deferred",
    "deferred": True,
    "partial": partial,
    "activity": activity,
    "finished_at": datetime.now(timezone.utc).isoformat(),
    "repair_suggestion": "Run explicit catch-up after the couch has been idle, or set MANGO_MAINTENANCE_IGNORE_COUCH_ACTIVITY=1 for an operator-forced maintenance window.",
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
PY
  grow_state set --phase deferred \
    --message "deferred: couch active" \
    --mode "$MODE" --preset "$MANGO_GROW_PRESET" --run-id "$RUN_ID" \
    --log "maintenance deferred phase=$phase couch active"
  python3 "$REPO_DIR/scripts/diag/ops-write-run.py" \
    --kind playability_maintenance \
    --run-id "$RUN_ID" \
    --source playability-maintenance \
    --write-report \
    --summary "maintenance deferred phase=$phase couch active" \
    --payload-file "$payload" || true
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
  local helper git_sha config_hash hash_json
  helper="$REPO_DIR/scripts/m3-play/playability/sqlite-publication.py"
  git_sha="$(git -C "$REPO_DIR" rev-parse HEAD)"
  hash_json="$(python3 "$helper" hash-config \
    "$MANGO_CATALOG_YAML" \
    "$FILTERS_JSON" \
    "$REPO_DIR/config/playability-policy.json" \
    "$REPO_DIR/config/rail-theme-profiles.yaml")"
  config_hash="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["config_hash"])' <<<"$hash_json")"
  PUBLICATION_ID="${RUN_ID}-${git_sha:0:12}"
  PUBLICATION_SNAPSHOT="${OPS_DIR}/prepublish-${RUN_ID}.db"
  PUBLICATION_RECEIPT="${OPS_DIR}/publication-${RUN_ID}.json"
  python3 "$helper" publish \
    --staged "$src" \
    --live "$dest" \
    --snapshot "$PUBLICATION_SNAPSHOT" \
    --publication-id "$PUBLICATION_ID" \
    --run-id "$RUN_ID" \
    --git-sha "$git_sha" \
    --config-hash "$config_hash" \
    | tee "$PUBLICATION_RECEIPT"
  PUBLISHED_STAGED_DB=1
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

sqlite_publish_failed_grow_memory() {
  local work_db="$1"
  local live_db="$2"
  local since_ms="$3"
  local now_ms="$4"
  if [[ ! -f "$work_db" || ! -f "$live_db" ]]; then
    return 0
  fi
  local summary
  summary="$(python3 "$REPO_DIR/scripts/diag/merge_failed_grow_memory.py" \
    --work-db "$work_db" \
    --live-db "$live_db" \
    --since-ms "$since_ms" \
    --now-ms "$now_ms")" || return 0
  echo "stage DB: merged failed grow memory: $summary"
  grow_state log "stage DB: merged failed grow memory: $summary"
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
    echo "stage DB: publishing completed grow to $LIVE_PLAYABILITY_DB"
    sqlite_publish_db "$WORK_PLAYABILITY_DB" "$LIVE_PLAYABILITY_DB"
    grow_state log "stage DB: published completed grow"
  else
    sqlite_publish_cursor_rewinds "$WORK_PLAYABILITY_DB" "$LIVE_PLAYABILITY_DB" || true
    sqlite_publish_failed_grow_memory "$WORK_PLAYABILITY_DB" "$LIVE_PLAYABILITY_DB" "$START_MS" "$END_MS" || true
    echo "stage DB: discarding failed or incomplete grow DB; live library unchanged"
    grow_state log "stage DB: discarded failed or incomplete grow DB"
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

  if [[ "${MANGO_SOURCE_HITRATE_PREFLIGHT:-0}" != "1" ]]; then
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

  local plan_json decision reason per_source source_total probe_sources merge_cache
  plan_json="$(python3 "$REPO_DIR/scripts/diag/source_hitrate_preflight.py" plan --preset "$preset" "${force_args[@]}")"
  decision="$(python3 -c "import json,sys; print(json.load(sys.stdin)['decision'])" <<<"$plan_json")"
  reason="$(python3 -c "import json,sys; print(json.load(sys.stdin)['reason'])" <<<"$plan_json")"
  per_source="$(python3 -c "import json,sys; print(json.load(sys.stdin)['per_source'])" <<<"$plan_json")"
  source_total="$(python3 -c "import json,sys; data=json.load(sys.stdin); print(data.get('probe_total') or data.get('source_total') or 0)" <<<"$plan_json")"
  probe_sources="$(python3 -c "import json,sys; print(','.join(json.load(sys.stdin).get('probe_sources') or []))" <<<"$plan_json")"
  merge_cache="$(python3 -c "import json,sys; print('1' if json.load(sys.stdin).get('merge_cache') else '0')" <<<"$plan_json")"

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
      MANGO_SOURCE_HITRATE_SOURCE_KEYS="$probe_sources" \
      MANGO_SOURCE_HITRATE_MERGE_CACHE="$merge_cache" \
      python3 "$REPO_DIR/scripts/diag/source-hitrate.py" 2>&1 \
      || true
  else
    PYTHONUNBUFFERED=1 \
      MANGO_SOURCE_HITRATE_PER_SOURCE="$per_source" \
      MANGO_SOURCE_HITRATE_SOURCE_KEYS="$probe_sources" \
      MANGO_SOURCE_HITRATE_MERGE_CACHE="$merge_cache" \
      python3 "$REPO_DIR/scripts/diag/source-hitrate.py" 2>&1 \
      | tee -a "${CACHE_DIR}/playability-grow.log" \
      || true
  fi
  unset MANGO_GROW_RUN_STATE

  grow_state set --phase preflight --message "hit-rate report written" \
    --mode "$MODE" --preset "$preset" \
    --log "source-hitrate preflight: complete"
}

INHERITED_COORDINATOR_LOCK="${MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD:-0}"
if [[ "$INHERITED_COORDINATOR_LOCK" != "1" ]]; then
  exec 200>>"$LOCK_FILE"
  if ! flock -n 200; then
    echo "another maintenance run is in progress ($LOCK_FILE)" >&2
    exit 2
  fi
fi
LOCK_RELEASED=0

cd "$REPO_DIR"

if ! couch_is_idle; then
  echo "maintenance deferred: couch active"
  write_deferred_report initial
  if [[ "$INHERITED_COORDINATOR_LOCK" != "1" ]]; then
    flock -u 200 >/dev/null 2>&1 || true
    exec 200>&- || true
  fi
  # A deliberate couch-activity defer is a safe partial outcome, not a
  # completed maintenance run. The coordinator records exit 10 as partial.
  exit 10
fi

# This configured-source mutation is inside the coordinator and after the
# initial couch-idle decision. It remains an explicit existing-ecosystem step,
# never part of a read-only status or source benchmark.
if [[ "${MANGO_SKIP_AIOMETADATA_SYNC:-0}" != "1" ]]; then
  bash "$REPO_DIR/scripts/m4-addons/sync-aiometadata-rail-catalogs.sh" || {
    echo "warn: AIOMetadata rail catalog sync failed — grow may miss mdblist sources" >&2
  }
fi

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
  if [[ "${INHERITED_COORDINATOR_LOCK:-0}" == "1" ]]; then
    LOCK_RELEASED=1
    return 0
  fi
  flock -u 200 >/dev/null 2>&1 || true
  exec 200>&- || true
  LOCK_RELEASED=1
}

restore_couch() {
  local restore_rc=0
  set_live_playability_db_env
  bash scripts/m3-play/playability/mpv-probe-pool.sh stop-all >/dev/null 2>&1 || true
  bash scripts/mango-kill-strays.sh >/dev/null 2>&1 || true
  # Publication already owns a verified prepublish snapshot. Avoid a redundant
  # multi-gigabyte all-state backup while the coordinator still owns the couch
  # outage; the ordinary stack-stop path retains its independent backup policy.
  if ! MANGO_CATALOG=1 MANGO_PLAYABILITY_TOPUP_ON_START=0 MANGO_STATE_BACKUP_ON_STOP=0 \
      bash scripts/mango-refresh.sh >/dev/null 2>&1; then
    echo "warn: mango-refresh failed during publication handoff" >&2
    restore_rc=1
  fi
  if [[ "$restore_rc" -eq 0 && "$PUBLISHED_STAGED_DB" == "1" ]]; then
    if ! curl -fsS --max-time 10 http://127.0.0.1:3020/playability/status \
      | python3 -c 'import json,sys; expected=sys.argv[1]; data=json.load(sys.stdin); actual=(data.get("publication") or {}).get("publication_id"); raise SystemExit(0 if actual == expected else 1)' \
        "$PUBLICATION_ID"; then
      echo "publication readback failed for $PUBLICATION_ID" >&2
      restore_rc=1
    else
      echo "publication readback: $PUBLICATION_ID"
      grow_state log "publication readback: $PUBLICATION_ID"
      python3 - "$OPS_DIR" <<'PY'
import sys
from pathlib import Path
ops = Path(sys.argv[1])
snapshots = sorted(ops.glob("prepublish-playability-*.db"), key=lambda path: path.stat().st_mtime, reverse=True)
for old in snapshots[3:]:
    old.unlink()
PY
    fi
  fi
  if [[ "$restore_rc" -ne 0 && "$PUBLISHED_STAGED_DB" == "1" && -f "$PUBLICATION_SNAPSHOT" ]]; then
    echo "publication handoff failed — restoring verified prepublish snapshot" >&2
    stop_catalog_service_only >/dev/null 2>&1 || true
    if python3 scripts/m3-play/playability/sqlite-publication.py restore \
        --snapshot "$PUBLICATION_SNAPSHOT" --live "$LIVE_PLAYABILITY_DB"; then
      PUBLISHED_STAGED_DB=0
      MANGO_CATALOG=1 MANGO_PLAYABILITY_TOPUP_ON_START=0 MANGO_STATE_BACKUP_ON_STOP=0 \
        bash scripts/mango-refresh.sh >/dev/null 2>&1 \
        || echo "warn: couch restart failed after publication rollback" >&2
    else
      echo "error: publication rollback failed" >&2
    fi
  fi
  cleanup_work_playability_db
  return "$restore_rc"
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
  if ! couch_is_idle; then
    echo "maintenance deferred before stopping launcher: couch active"
    write_deferred_report pre_stop_launcher
    release_maintenance_lock
    trap - EXIT
    exit 10
  fi
  echo "stopping launcher browser"
  pkill -f 'chromium.*127.0.0.1:3000' >/dev/null 2>&1 || true
  pkill -f 'firefox.*127.0.0.1:3000' >/dev/null 2>&1 || true
  sleep 1
fi

if curl -sf --max-time 2 http://127.0.0.1:3020/health >/dev/null 2>&1; then
  if ! couch_is_idle; then
    echo "maintenance deferred before stopping catalog: couch active"
    write_deferred_report pre_stop_catalog
    release_maintenance_lock
    exit 10
  fi
  if [[ "$MODE" == "grow" ]]; then
    run_source_hitrate_preflight quick "${MANGO_SOURCE_HITRATE_FORCE:-0}"
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
export MANGO_CATALOG_FETCH_TIMEOUT_MS="${MANGO_CATALOG_FETCH_TIMEOUT_MS:-8000}"
export MANGO_CATALOG_COMPOSITE_FETCH_CONCURRENCY="${MANGO_CATALOG_COMPOSITE_FETCH_CONCURRENCY:-8}"
export MANGO_GROW_HITRATE_WEIGHTS="${MANGO_GROW_HITRATE_WEIGHTS:-1}"
export MANGO_GROW_REQUIRE_TARGET="${MANGO_GROW_REQUIRE_TARGET:-0}"
export MANGO_GROW_SOURCE_RESET_CYCLES="${MANGO_GROW_SOURCE_RESET_CYCLES:-10}"
export MANGO_GROW_SOURCE_ADVANCE_PAGES="${MANGO_GROW_SOURCE_ADVANCE_PAGES:-25}"
export MANGO_PLAYABILITY_GROW_INGEST_BATCH="${MANGO_PLAYABILITY_GROW_INGEST_BATCH:-80}"
export MANGO_PLAYABILITY_MAX_INGEST_SCAN="${MANGO_PLAYABILITY_MAX_INGEST_SCAN:-2400}"
export MANGO_GROW_NO_STREAM_RETRY_MS="${MANGO_GROW_NO_STREAM_RETRY_MS:-604800000}"
PHASE_COOLDOWN_SEC="${MANGO_MAINTENANCE_PHASE_COOLDOWN_SEC:-45}"

# H1/H3/H5 hooks must persist to the LIVE DB regardless of grow success/failure.
# Run them BEFORE stage_playability_db_if_needed points MANGO_PLAYABILITY_DB at
# the work DB. The indexer boots its own CatalogCore (no catalog service needed),
# mirroring the refresh command. MANGO_MAINTENANCE_HOOKS_PRESTAGE=1 tells
# refreshAllRails not to re-run these hooks inside the work DB.
run_maintenance_hooks_prestage() {
  if [[ "$MODE" != "grow" && "$MODE" != "nightly" ]]; then
    return 0
  fi
  if [[ "${MANGO_MAINTENANCE_HOOKS_PRESTAGE:-1}" == "0" ]]; then
    return 0
  fi
  echo "== maintenance hooks (live DB) =="
  grow_state set --phase maintenance_hooks \
    --message "running H1/H3/H5 hooks against live DB" \
    --mode "$MODE" --preset "$MANGO_GROW_PRESET" \
    --log "maintenance hooks: pre-stage sweep/drain/migrate on live DB"
  set_live_playability_db_env
  local hooks_rc=0
  set +e
  MANGO_MAINTENANCE_HOOKS_PRESTAGE=1 \
    MANGO_PLAYABILITY_DB="$LIVE_PLAYABILITY_DB" \
    npm --prefix src/catalog-service exec tsx -- \
    scripts/m3-play/playability/playability-indexer.ts maintenance-hooks 2>&1
  hooks_rc=$?
  set -e
  if [[ "$hooks_rc" -ne 0 ]]; then
    echo "warn: maintenance-hooks rc=$hooks_rc — continuing; hooks will retry next run" >&2
    grow_state log "maintenance hooks: warn rc=$hooks_rc (continuing — grow still runs)"
  fi
  # Persist the prestage flag into the parent shell so the subsequent refresh
  # invocation (run_refresh -> playability-indexer.ts refresh) sees it and skips
  # re-running H1/H3 hooks inside the staged work DB. The refresh command's own
  # env inheritance picks this up; stage_playability_db_if_needed will override
  # MANGO_PLAYABILITY_DB to point at the work DB.
  export MANGO_MAINTENANCE_HOOKS_PRESTAGE=1
}

run_maintenance_hooks_prestage

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
  if ! couch_is_idle; then
    echo "nightly grow phase deferred: couch active"
    write_deferred_report nightly_grow_phase
    REFRESH_JSON="$STALE_JSON"
    REFRESH_RC=0
  else
    echo "== phase 2: grow pass (preset=$MANGO_GROW_PRESET) =="
    if [[ "${MANGO_SOURCE_HITRATE_PREFLIGHT:-0}" == "1" ]]; then
      grow_state set --phase preflight \
        --message "starting catalog for explicit hit-rate benchmark" \
        --mode "$MODE" --preset "$MANGO_GROW_PRESET" \
        --log "nightly grow: explicit hit-rate benchmark before grow phase"
      MANGO_CATALOG=1 start_catalog_service_only \
        || grow_state log "warn: catalog start for hitrate failed — using cached report"
      run_source_hitrate_preflight nightly "${MANGO_SOURCE_HITRATE_FORCE:-0}"
      stop_catalog_service_only
    else
      grow_state log "nightly grow: source hit-rate benchmark excluded from critical path"
    fi
    write_grow_baseline_if_needed grow
    grow_state set --phase grow --message "grow refresh in progress" --mode "$MODE" --preset "$MANGO_GROW_PRESET"
    REFRESH_JSON="$(run_refresh grow 2>&1)"
    REFRESH_RC=$?
    echo "$REFRESH_JSON"
    if [[ "$STALE_RC" -ne 0 && "$REFRESH_RC" -eq 0 ]]; then
      REFRESH_RC=$STALE_RC
    fi
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
REFRESH_WRITE_KIND=""
REFRESH_STATE_PATH="${CACHE_DIR}/grow-run-state.json"
if REFRESH_WRITE_KIND="$(printf '%s' "$REFRESH_JSON" | python3 "$REPO_DIR/scripts/diag/extract_refresh_json.py" \
  --out "$REFRESH_OUT" \
  --mode "$MODE" \
  --run-id "$RUN_ID" \
  --start-ms "$START_MS" \
  --end-ms "$END_MS" \
  --rc "$REFRESH_RC" \
  --state-path "$REFRESH_STATE_PATH")"; then
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
if [[ "$REFRESH_RC" -ne 0 && "$REFRESH_WRITE_KIND" == "fallback" ]]; then
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
if ! restore_couch; then
  echo "maintenance failed during catalog publication handoff; previous DB restored when possible" >&2
  exit 1
fi

REFRESH_STOP_REASON=""
if [[ "$REFRESH_OUT_WRITTEN" == "1" && -f "$REFRESH_OUT" ]]; then
  REFRESH_STOP_REASON="$(python3 - "$REFRESH_OUT" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle).get("stop_reason") or "")
PY
  )"
fi
if [[ "$REFRESH_STOP_REASON" == "couch_activity" || "$REFRESH_STOP_REASON" == "admission_deadline" ]]; then
  echo "maintenance yielded safely: $REFRESH_STOP_REASON"
  grow_state set --phase yielded --message "yielded: $REFRESH_STOP_REASON" \
    --mode "$MODE" --preset "$MANGO_GROW_PRESET" \
    --log "maintenance yielded stop_reason=$REFRESH_STOP_REASON"
  release_maintenance_lock
  exit 10
fi

python3 "$REPO_DIR/scripts/diag/grow_monitor.py" status 2>/dev/null || true
python3 "$REPO_DIR/scripts/diag/playability-status.py" 2>/dev/null | tail -20 || true
if [[ "$MODE" == "grow" || "$MODE" == "nightly" ]] && [[ "$REFRESH_OUT_WRITTEN" == "1" ]]; then
  python3 "$REPO_DIR/scripts/diag/grow_monitor.py" assess --refresh-json "$REFRESH_OUT" 2>/dev/null || true
  if [[ "${MANGO_QUEUE_VOD_RECOMMENDATIONS_AFTER_GROW:-1}" == "1" ]]; then
    CATALOG_URL="http://${MANGO_CATALOG_HOST:-127.0.0.1}:${MANGO_CATALOG_PORT:-3020}"
    VOD_RECOMMENDATION_TIMEOUT_SEC="${MANGO_VOD_RECOMMENDATION_REFRESH_TIMEOUT_SEC:-900}"
    if ! [[ "$VOD_RECOMMENDATION_TIMEOUT_SEC" =~ ^[1-9][0-9]*$ ]]; then
      echo "MANGO_VOD_RECOMMENDATION_REFRESH_TIMEOUT_SEC must be a positive integer" >&2
      exit 2
    fi
    VOD_RECOMMENDATION_RESPONSE="$(mktemp)"
    VOD_RECOMMENDATION_STATE="$(mktemp)"
    trap 'rm -f "$VOD_RECOMMENDATION_RESPONSE" "$VOD_RECOMMENDATION_STATE"' EXIT
    if curl -fsS -m 10 -X POST \
        -H 'content-type: application/json' \
        --data '{"reason":"playability_corpus_publication"}' \
        "${CATALOG_URL}/recommendations/refresh" >"$VOD_RECOMMENDATION_RESPONSE"; then
      if ! VOD_RECOMMENDATION_JOB_IDS="$(python3 - "$VOD_RECOMMENDATION_RESPONSE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
if payload.get("ok") is not True:
    raise SystemExit("VOD recommendation refresh response was not ok")
jobs = payload.get("jobs")
if not isinstance(jobs, list) or not jobs:
    raise SystemExit("VOD recommendation refresh response contained no jobs")
job_ids = []
for job in jobs:
    job_id = str(job.get("job_id") or "").strip() if isinstance(job, dict) else ""
    if not job_id:
        raise SystemExit("VOD recommendation refresh response contained a job without an id")
    job_ids.append(job_id)
print(",".join(job_ids))
PY
      )"; then
        rm -f "$VOD_RECOMMENDATION_RESPONSE" "$VOD_RECOMMENDATION_STATE"
        echo "VOD recommendation refresh response was invalid; last-good remains active" >&2
        exit 10
      fi
      echo "playability maintenance: waiting for VOD recommendation jobs $VOD_RECOMMENDATION_JOB_IDS"
      IFS=',' read -r -a VOD_RECOMMENDATION_JOB_ID_LIST <<<"$VOD_RECOMMENDATION_JOB_IDS"
      VOD_RECOMMENDATION_DEADLINE=$((SECONDS + VOD_RECOMMENDATION_TIMEOUT_SEC))
      VOD_RECOMMENDATION_STATUS="pending"
      VOD_RECOMMENDATION_DETAIL=""
      while (( SECONDS < VOD_RECOMMENDATION_DEADLINE )); do
        : >"$VOD_RECOMMENDATION_STATE"
        for VOD_RECOMMENDATION_JOB_ID in "${VOD_RECOMMENDATION_JOB_ID_LIST[@]}"; do
          if ! curl -fsS -m 5 \
              "${CATALOG_URL}/recommendations/jobs/${VOD_RECOMMENDATION_JOB_ID}" \
              >>"$VOD_RECOMMENDATION_STATE"; then
            rm -f "$VOD_RECOMMENDATION_RESPONSE" "$VOD_RECOMMENDATION_STATE"
            echo "VOD recommendation exact job read failed for ${VOD_RECOMMENDATION_JOB_ID}; last-good remains active" >&2
            exit 10
          fi
          printf '\n' >>"$VOD_RECOMMENDATION_STATE"
        done
        VOD_RECOMMENDATION_LINE="$(python3 - "$VOD_RECOMMENDATION_STATE" "$VOD_RECOMMENDATION_JOB_IDS" <<'PY'
import json
import sys

path, joined_ids = sys.argv[1:]
expected = joined_ids.split(",")
with open(path, encoding="utf-8") as handle:
    payloads = [json.loads(line) for line in handle if line.strip()]
by_id = {}
for payload in payloads:
    job = payload.get("job") if isinstance(payload, dict) else None
    if isinstance(job, dict) and job.get("job_id"):
        by_id[str(job["job_id"])] = job
missing = [job_id for job_id in expected if job_id not in by_id]
if missing:
    print("missing\t" + ",".join(missing))
    raise SystemExit(0)
failed = [
    f"{job_id}:{by_id[job_id].get('error') or 'unknown error'}"
    for job_id in expected
    if by_id[job_id].get("status") == "failed"
]
if failed:
    print("failed\t" + " | ".join(failed).replace("\t", " ").replace("\n", " "))
    raise SystemExit(0)
statuses = {job_id: str(by_id[job_id].get("status") or "unknown") for job_id in expected}
invalid = [f"{job_id}:{status}" for job_id, status in statuses.items()
           if status not in {"queued", "running", "complete", "coalesced"}]
if invalid:
    print("invalid\t" + ",".join(invalid))
elif all(status in {"complete", "coalesced"} for status in statuses.values()):
    print("complete\t" + ",".join(f"{job_id}:{statuses[job_id]}" for job_id in expected))
else:
    print("pending\t" + ",".join(f"{job_id}:{statuses[job_id]}" for job_id in expected))
PY
        )"
        IFS=$'\t' read -r VOD_RECOMMENDATION_STATUS VOD_RECOMMENDATION_DETAIL <<<"$VOD_RECOMMENDATION_LINE"
        case "$VOD_RECOMMENDATION_STATUS" in
          complete) break ;;
          pending) sleep 1 ;;
          missing|failed|invalid)
            rm -f "$VOD_RECOMMENDATION_RESPONSE" "$VOD_RECOMMENDATION_STATE"
            echo "VOD recommendation refresh $VOD_RECOMMENDATION_STATUS: $VOD_RECOMMENDATION_DETAIL; last-good remains active" >&2
            exit 10
            ;;
          *)
            rm -f "$VOD_RECOMMENDATION_RESPONSE" "$VOD_RECOMMENDATION_STATE"
            echo "VOD recommendation refresh returned an invalid aggregate status; last-good remains active" >&2
            exit 10
            ;;
        esac
      done
      rm -f "$VOD_RECOMMENDATION_RESPONSE" "$VOD_RECOMMENDATION_STATE"
      trap - EXIT
      if [[ "$VOD_RECOMMENDATION_STATUS" != "complete" ]]; then
        echo "VOD recommendation jobs timed out after ${VOD_RECOMMENDATION_TIMEOUT_SEC}s ($VOD_RECOMMENDATION_DETAIL); last-good remains active" >&2
        exit 10
      fi
      echo "playability maintenance: VOD recommendation jobs complete ($VOD_RECOMMENDATION_DETAIL)"
    else
      rm -f "$VOD_RECOMMENDATION_RESPONSE" "$VOD_RECOMMENDATION_STATE"
      echo "VOD recommendation refresh enqueue failed; last-good remains active" >&2
      exit 10
    fi
  fi
fi

echo "maintenance complete"
grow_state set --phase done --message "complete rc=$REFRESH_RC" --mode "$MODE" --preset "$MANGO_GROW_PRESET" \
  --log "maintenance complete mode=$MODE rc=$REFRESH_RC duration_ms=$((END_MS - START_MS))"
release_maintenance_lock
