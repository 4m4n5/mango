#!/usr/bin/env bash
# Create one atomic, verified backup set for Mango-owned SQLite state.

set -euo pipefail

BACKUP_DIR="${MANGO_STATE_BACKUP_DIR:-$HOME/.local/share/mango/backups/state}"
RETENTION="${MANGO_STATE_BACKUP_RETENTION:-3}"
QUIET=0

if [[ "${1:-}" == "--quiet" ]]; then
  QUIET=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--quiet]" >&2
  exit 2
fi

if [[ ! "$RETENTION" =~ ^[1-9][0-9]*$ ]]; then
  echo "MANGO_STATE_BACKUP_RETENTION must be a positive integer" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ"))')"
temporary_set="$BACKUP_DIR/.state-$timestamp.tmp"
final_set="$BACKUP_DIR/state-$timestamp"
mkdir -m 700 "$temporary_set"

cleanup() {
  [[ -d "$temporary_set" ]] && rm -rf -- "$temporary_set"
}
trap cleanup EXIT

python3 - "$temporary_set" \
  "progress=${MANGO_PROGRESS_DB_PATH:-/etc/mango/progress.db}" \
  "library=${MANGO_LIBRARY_DB_PATH:-/etc/mango/library.db}" \
  "playability=${MANGO_PLAYABILITY_DB_PATH:-/etc/mango/playability.db}" \
  "youtube=${MANGO_YOUTUBE_DB_PATH:-/etc/mango/youtube.db}" <<'PY'
import json
import os
from pathlib import Path
import sqlite3
import sys
from datetime import datetime, timezone

destination = Path(sys.argv[1])
sources = []
for argument in sys.argv[2:]:
    label, raw_path = argument.split("=", 1)
    source_path = Path(raw_path)
    if source_path.is_file():
        sources.append((label, source_path))

if not sources:
    raise SystemExit("no Mango state databases exist to back up")

manifest = {
    "format": "mango-state-backup-v2",
    "created_at": datetime.now(timezone.utc).isoformat(),
    "databases": [],
}

for label, source_path in sources:
    target_path = destination / f"{label}.db"
    source = None
    target = None
    try:
        source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
        target = sqlite3.connect(target_path)
        source.backup(target)
        result = target.execute("PRAGMA quick_check").fetchone()
        if result is None or result[0] != "ok":
            raise sqlite3.DatabaseError(f"quick_check failed for {label}: {result}")
    finally:
        if target is not None:
            target.close()
        if source is not None:
            source.close()

    os.chmod(target_path, 0o600)
    manifest["databases"].append({
        "label": label,
        "source": str(source_path),
        "file": target_path.name,
        "bytes": target_path.stat().st_size,
        "quick_check": "ok",
    })

manifest_path = destination / "manifest.json"
manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
os.chmod(manifest_path, 0o600)
PY

mv -- "$temporary_set" "$final_set"
trap - EXIT

# Prune only complete v2 sets, and only after the replacement set verifies and
# publishes atomically. Legacy flat files are handled by the explicit migration
# helper so an ordinary service restart cannot silently reinterpret them.
python3 - "$BACKUP_DIR" "$RETENTION" <<'PY'
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]).resolve()
retention = int(sys.argv[2])
sets = sorted(
    (path for path in root.iterdir()
     if path.is_dir() and path.name.startswith("state-")
     and (path / "manifest.json").is_file()),
    key=lambda path: path.name,
    reverse=True,
)
for obsolete in sets[retention:]:
    shutil.rmtree(obsolete)
PY

if [[ "$QUIET" != "1" ]]; then
  echo "verified state backup: $final_set"
  echo "retained newest $RETENTION complete state backup set(s)"
fi
