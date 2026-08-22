#!/usr/bin/env bash
# Infrequent offline compaction hook for /etc/mango/library.db.
# Never part of nightly critical path.
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
STAMP_FILE="${MANGO_LIBRARY_COMPACTION_STAMP:-$CACHE_DIR/library-offline-compaction.last}"
MIN_HOURS="${MANGO_LIBRARY_COMPACTION_MIN_HOURS:-168}"
FORCE=0
DRY_RUN=0
STATUS=0

usage() {
  cat <<EOF
usage: $0 [--force] [--dry-run] [--status]

Runs offline library compaction through prune-mango-state.sh --vacuum.
Default cooldown is 168h (override MANGO_LIBRARY_COMPACTION_MIN_HOURS).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --status) STATUS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if ! [[ "$MIN_HOURS" =~ ^[0-9]+$ ]]; then
  echo "MANGO_LIBRARY_COMPACTION_MIN_HOURS must be a non-negative integer" >&2
  exit 2
fi

mkdir -p "$CACHE_DIR"
cd "$REPO_DIR"

now_sec="$(python3 -c 'import time; print(int(time.time()))')"
last_sec=0
if [[ -f "$STAMP_FILE" ]]; then
  last_sec="$(python3 - "$STAMP_FILE" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
print(int(path.stat().st_mtime))
PY
  )"
fi
age_sec=$((now_sec - last_sec))
age_hours=$((age_sec / 3600))
due=1
if [[ "$FORCE" != "1" && "$last_sec" -gt 0 && "$age_hours" -lt "$MIN_HOURS" ]]; then
  due=0
fi

if [[ "$STATUS" == "1" ]]; then
  echo "library-offline-compaction: due=$due age_hours=$age_hours min_hours=$MIN_HOURS stamp=$STAMP_FILE"
  exit 0
fi

if [[ "$due" != "1" ]]; then
  echo "library-offline-compaction: skipped (cooldown ${age_hours}h < ${MIN_HOURS}h)"
  exit 10
fi

if [[ "${MANGO_LIBRARY_COMPACTION_IGNORE_COUCH_ACTIVITY:-0}" != "1" ]]; then
  if ! bash "$REPO_DIR/scripts/lib/couch-activity.sh" is-idle >/dev/null 2>&1; then
    echo "library-offline-compaction: skipped (couch active)"
    exit 10
  fi
fi

if [[ "${MANGO_LIBRARY_COMPACTION_IGNORE_RECOMMENDATION_LEASE:-0}" != "1" ]]; then
  lease_path="${MANGO_RECOMMENDATION_MAINTENANCE_LEASE:-${CACHE_DIR}/recommendation-maintenance.lease}"
  if python3 "$REPO_DIR/scripts/diag/recommendation_maintenance_lease.py" "$lease_path" >/dev/null 2>&1; then
    echo "library-offline-compaction: skipped (VOD recommendation maintenance active)"
    exit 10
  fi
fi

if [[ "${MANGO_LIBRARY_COMPACTION_IGNORE_MAINTENANCE_LOCK:-0}" != "1" ]]; then
  if ! python3 - "$CACHE_DIR/playability-maintenance.lock" <<'PY'
import fcntl
import os
import sys
path = sys.argv[1]
try:
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
except OSError:
    raise SystemExit(1)
try:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit(1)
    raise SystemExit(0)
finally:
    try:
        fcntl.flock(fd, fcntl.LOCK_UN)
    except OSError:
        pass
    os.close(fd)
PY
  then
    echo "library-offline-compaction: skipped (playability maintenance lock active)"
    exit 10
  fi
fi

compact_script="${MANGO_LIBRARY_COMPACTION_SCRIPT:-$REPO_DIR/scripts/m6-ship/prune-mango-state.sh}"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "library-offline-compaction: dry-run would execute $compact_script --vacuum"
  exit 0
fi

bash "$compact_script" --vacuum
python3 - "$STAMP_FILE" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text("ok\n", encoding="utf-8")
PY
echo "library-offline-compaction: complete"
