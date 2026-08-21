#!/usr/bin/env bash
# Run movie/TV playability maintenance, then independently refresh YouTube.

set -uo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
LOG="${CACHE_DIR}/nightly-library-refresh.log"
MODE="${MANGO_PLAYABILITY_REFRESH_MODE:-nightly}"
PRESET="${MANGO_GROW_PRESET:-}"
DETACH=0
STATUS=0

usage() {
  cat <<EOF
usage: $0 [--mode nightly|grow|stale] [--preset quick|nightly|overnight] [--detach] [--status]

Runs playability maintenance first, then runs scripts/m6-ship/youtube-refresh-cache.sh
even when playability exits non-zero. If another playability maintenance lock is
still held after the attempt, YouTube is skipped to avoid overlapping indexers.
EOF
}

normalize_mode() {
  case "$1" in
    nightly|grow|stale) echo "$1" ;;
    *) echo "mode must be nightly, grow, or stale (got: $1)" >&2; exit 2 ;;
  esac
}

normalize_preset() {
  case "$1" in
    quick|nightly|overnight) echo "$1" ;;
    *) echo "preset must be quick, nightly, or overnight (got: $1)" >&2; exit 2 ;;
  esac
}

recommendation_maintenance_active() {
  local lease_path="${MANGO_RECOMMENDATION_MAINTENANCE_LEASE:-${CACHE_DIR}/recommendation-maintenance.lease}"
  python3 "$REPO_DIR/scripts/diag/recommendation_maintenance_lease.py" "$lease_path"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --preset) PRESET="${2:-}"; shift 2 ;;
    --detach) DETACH=1; shift ;;
    --status) STATUS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

MODE="$(normalize_mode "$MODE")"
if [[ -n "$PRESET" ]]; then
  PRESET="$(normalize_preset "$PRESET")"
fi

if [[ "$STATUS" -eq 1 ]]; then
  python3 "$REPO_DIR/scripts/diag/grow_monitor.py" status || true
  exit 0
fi

if [[ "${MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD:-0}" != "1" ]]; then
  run_args=(--mode "$MODE")
  if [[ -n "$PRESET" ]]; then
    run_args+=(--preset "$PRESET")
  fi
  [[ "$DETACH" -eq 1 ]] && run_args+=(--detach)
  exec bash "$REPO_DIR/scripts/m3-play/playability/playability-grow.sh" "${run_args[@]}"
fi

mkdir -p "$CACHE_DIR"
touch "$LOG"
if [[ "${MANGO_NIGHTLY_REFRESH_LOG_WRAPPED:-0}" != "1" ]]; then
  exec > >(tee -a "$LOG") 2>&1
fi

cd "$REPO_DIR"

if [[ -n "$PRESET" ]]; then
  export MANGO_GROW_PRESET="$PRESET"
fi
export MANGO_PLAYABILITY_REFRESH_MODE="$MODE"

echo "== mango nightly library refresh (mode=$MODE preset=${PRESET:-auto}) =="
PLAYABILITY_RC=0
bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode "$MODE" || PLAYABILITY_RC=$?
echo "nightly library refresh: playability_rc=$PLAYABILITY_RC"

# Rotate the browse session so the home rails re-pick from the freshly-grown pool
# and new titles surface right away. Daily auto-rotation also covers this, but the
# post-grow nudge makes new content visible the same night. Non-fatal.
if [[ "${MANGO_NIGHTLY_SESSION_RESHUFFLE:-1}" == "1" ]]; then
  CATALOG_URL="http://${MANGO_CATALOG_HOST:-127.0.0.1}:${MANGO_CATALOG_PORT:-3020}"
  if curl -fsS -m 10 -X POST "${CATALOG_URL}/playability/session/reshuffle" >/dev/null 2>&1; then
    echo "nightly library refresh: browse session reshuffled (new titles surfaced)"
  else
    echo "nightly library refresh: session reshuffle skipped (catalog-service unreachable)" >&2
  fi
fi

YOUTUBE_RC=0
if [[ "${MANGO_NIGHTLY_YOUTUBE_REFRESH:-1}" != "1" ]]; then
  echo "nightly library refresh: youtube skipped (MANGO_NIGHTLY_YOUTUBE_REFRESH=${MANGO_NIGHTLY_YOUTUBE_REFRESH:-})"
else
  bash "$REPO_DIR/scripts/m6-ship/youtube-refresh-cache.sh" \
      --reason "${MANGO_YOUTUBE_REFRESH_REASON:-nightly_after_playability_${MODE}}" \
    || YOUTUBE_RC=$?
fi

echo "nightly library refresh: complete playability_rc=$PLAYABILITY_RC youtube_rc=$YOUTUBE_RC"

# Reclaim -wal disk after the write-heavy YouTube pass. Best-effort and non-fatal:
# a TRUNCATE checkpoint is a no-op if the live service is mid-write. playability.db
# is already checkpointed on staged publish; this covers library/progress/youtube.
if [[ "${MANGO_NIGHTLY_WAL_CHECKPOINT:-1}" == "1" ]]; then
  bash "$REPO_DIR/scripts/lib/checkpoint-wal-dbs.sh" || true
fi

# Idle-gated library VACUUM after grow/prune/WAL checkpoint. Exclusive lock;
# never on the couch path. Pre-copy beside the file so a bad vacuum can roll back.
if [[ "${MANGO_NIGHTLY_VACUUM:-1}" == "1" ]]; then
  LIBRARY_DB="${MANGO_LIBRARY_DB_PATH:-/etc/mango/library.db}"
  PLAYBACK_ACTIVE_FILE="${MANGO_PLAYBACK_ACTIVE_FILE:-${CACHE_DIR}/playback-active}"
  couch_idle=0
  if [[ -f "$REPO_DIR/scripts/lib/couch-activity.sh" ]] \
      && bash "$REPO_DIR/scripts/lib/couch-activity.sh" is-idle >/dev/null 2>&1; then
    couch_idle=1
  fi
  if [[ -f "$PLAYBACK_ACTIVE_FILE" ]]; then
    echo "nightly library refresh: VACUUM skipped (playback active)"
  elif [[ "$couch_idle" -ne 1 ]]; then
    echo "nightly library refresh: VACUUM skipped (couch not idle)"
  elif recommendation_maintenance_active; then
    echo "nightly library refresh: VACUUM skipped (VOD recommendation maintenance active)"
  elif [[ ! -f "$LIBRARY_DB" ]]; then
    echo "nightly library refresh: VACUUM skipped (library.db missing)"
  else
    pre="${LIBRARY_DB}.pre-vacuum"
    echo "nightly library refresh: pre-copy $LIBRARY_DB -> $pre"
    cp -a "$LIBRARY_DB" "$pre" || true
    [[ -f "${LIBRARY_DB}-wal" ]] && cp -a "${LIBRARY_DB}-wal" "${pre}-wal" || true
    [[ -f "${LIBRARY_DB}-shm" ]] && cp -a "${LIBRARY_DB}-shm" "${pre}-shm" || true
    BSQLITE="$REPO_DIR/src/catalog-service/node_modules/better-sqlite3"
    if node -e '
      const Database = require(process.argv[1]);
      const db = new Database(process.argv[2], { timeout: 8000 });
      try {
        const freelist = Number(db.pragma("freelist_count", { simple: true }) || 0);
        if (freelist < 1024) {
          console.log("nightly library refresh: VACUUM skipped (freelist=" + freelist + ")");
        } else {
          db.exec("VACUUM");
          console.log("nightly library refresh: VACUUM complete (freelist was " + freelist + ")");
        }
      } finally {
        db.close();
      }
    ' "$BSQLITE" "$LIBRARY_DB"; then
      true
    else
      echo "nightly library refresh: VACUUM skipped (busy or unavailable)" >&2
    fi
  fi
fi

# Inspect stable lock ownership before proof. Existing lock pathnames are
# normal permanent state and are never removed as crash cleanup.
if [[ -f "$REPO_DIR/scripts/lib/stale-flock-cleanup.sh" ]]; then
  echo "nightly library refresh: pre-proof stale-flock cleanup"
  bash "$REPO_DIR/scripts/lib/stale-flock-cleanup.sh" || true
fi

PROOF_RC=0
if [[ "${MANGO_NIGHTLY_RELIABILITY_PROOF:-1}" == "1" ]]; then
  bash "$REPO_DIR/scripts/m6-ship/reliability-proof.sh" \
    --reason "nightly_after_playability_${MODE}" \
    --playability-rc "$PLAYABILITY_RC" \
    --youtube-rc "$YOUTUBE_RC" \
    || PROOF_RC=$?
else
  echo "nightly library refresh: reliability proof skipped (MANGO_NIGHTLY_RELIABILITY_PROOF=${MANGO_NIGHTLY_RELIABILITY_PROOF:-})"
fi
echo "nightly library refresh: proof_rc=$PROOF_RC"
if [[ "$PLAYABILITY_RC" -ne 0 && "$PLAYABILITY_RC" -ne 10 ]]; then
  exit 1
fi
if [[ "$PLAYABILITY_RC" -eq 10 || "$YOUTUBE_RC" -ne 0 || "$PROOF_RC" -ne 0 ]]; then
  echo "nightly library refresh: partial — validated playability output retained with last-good downstream output" >&2
  exit 10
fi
