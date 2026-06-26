#!/usr/bin/env bash
# Back up Mango-owned local state DBs using SQLite's online backup API.

set -euo pipefail

BACKUP_DIR="${MANGO_STATE_BACKUP_DIR:-$HOME/.local/share/mango/backups/state}"
RETENTION="${MANGO_STATE_BACKUP_RETENTION:-20}"
QUIET=0

if [[ "${1:-}" == "--quiet" ]]; then
  QUIET=1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"

backup_db() {
  local label="$1"
  local source="$2"
  local target="$BACKUP_DIR/${label}-${timestamp}.db"

  [[ -f "$source" ]] || return 0

  python3 - "$source" "$target" <<'PY'
import shutil
import sqlite3
import sys

source_path, target_path = sys.argv[1], sys.argv[2]
try:
    source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
    target = sqlite3.connect(target_path)
    with target:
        source.backup(target)
    source.close()
    target.close()
except sqlite3.DatabaseError:
    shutil.copy2(source_path, target_path)
PY

  [[ "$QUIET" == "1" ]] || echo "backed up $source -> $target"
}

prune_backups() {
  local label="$1"
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "${label}-*.db" -print \
    | sort -r \
    | awk -v keep="$RETENTION" 'NR > keep' \
    | xargs -r rm -f
}

backup_db progress "${MANGO_PROGRESS_DB_PATH:-/etc/mango/progress.db}"
backup_db library "${MANGO_LIBRARY_DB_PATH:-/etc/mango/library.db}"
prune_backups progress
prune_backups library

[[ "$QUIET" == "1" ]] || echo "state backups retained in $BACKUP_DIR"
