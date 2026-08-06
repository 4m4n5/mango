#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

python3 - "$TEST_ROOT" <<'PY'
from pathlib import Path
import sqlite3
import sys

root = Path(sys.argv[1])
for name in ("progress", "library", "playability", "youtube"):
    connection = sqlite3.connect(root / f"{name}.db")
    connection.execute("CREATE TABLE proof (value TEXT NOT NULL)")
    connection.execute("INSERT INTO proof VALUES (?)", (name,))
    connection.commit()
    connection.close()
PY

for _ in 1 2 3 4 5; do
  MANGO_STATE_BACKUP_DIR="$TEST_ROOT/backups/state" \
  MANGO_STATE_BACKUP_RETENTION=3 \
  MANGO_PROGRESS_DB_PATH="$TEST_ROOT/progress.db" \
  MANGO_LIBRARY_DB_PATH="$TEST_ROOT/library.db" \
  MANGO_PLAYABILITY_DB_PATH="$TEST_ROOT/playability.db" \
  MANGO_YOUTUBE_DB_PATH="$TEST_ROOT/youtube.db" \
    bash "$REPO_DIR/scripts/m6-ship/backup-library-state.sh" --quiet
done

[[ "$(find "$TEST_ROOT/backups/state" -mindepth 1 -maxdepth 1 -type d -name 'state-*' | wc -l | tr -d ' ')" == "3" ]]
python3 - "$TEST_ROOT/backups/state" <<'PY'
import json
from pathlib import Path
import sqlite3
import sys

root = Path(sys.argv[1])
for backup_set in root.glob("state-*"):
    manifest = json.loads((backup_set / "manifest.json").read_text())
    assert manifest["format"] == "mango-state-backup-v2"
    assert {item["label"] for item in manifest["databases"]} == {
        "progress", "library", "playability", "youtube"
    }
    for item in manifest["databases"]:
        path = backup_set / item["file"]
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        assert connection.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        connection.close()
PY

# A failed source backup must not prune or publish a replacement set.
before="$(find "$TEST_ROOT/backups/state" -mindepth 1 -maxdepth 1 -type d -name 'state-*' | sort)"
printf 'not sqlite' > "$TEST_ROOT/library.db"
if MANGO_STATE_BACKUP_DIR="$TEST_ROOT/backups/state" \
  MANGO_STATE_BACKUP_RETENTION=3 \
  MANGO_PROGRESS_DB_PATH="$TEST_ROOT/progress.db" \
  MANGO_LIBRARY_DB_PATH="$TEST_ROOT/library.db" \
  MANGO_PLAYABILITY_DB_PATH="$TEST_ROOT/playability.db" \
  MANGO_YOUTUBE_DB_PATH="$TEST_ROOT/youtube.db" \
    bash "$REPO_DIR/scripts/m6-ship/backup-library-state.sh" --quiet 2>/dev/null; then
  echo "expected corrupt source backup to fail" >&2
  exit 1
fi
after="$(find "$TEST_ROOT/backups/state" -mindepth 1 -maxdepth 1 -type d -name 'state-*' | sort)"
[[ "$before" == "$after" ]]

# The one-time legacy migration keeps three verified sets in each class and
# ignores non-backup evidence directories.
python3 - "$TEST_ROOT" <<'PY'
from pathlib import Path
import os
import shutil
import sys

root = Path(sys.argv[1])
legacy = root / "legacy"
state = legacy / "state"
snapshots = legacy / "agent-snapshots"
state.mkdir(parents=True)
snapshots.mkdir(parents=True)
for index in range(5):
    stamp = f"2026080{index + 1}-010101"
    shutil.copy2(root / "progress.db", state / f"progress-{stamp}.db")
    shutil.copy2(root / "playability.db", state / f"library-{stamp}.db")
    snapshot = snapshots / f"deploy-pre-{stamp}"
    snapshot.mkdir()
    shutil.copy2(root / "youtube.db", snapshot / "library.db")
    os.utime(snapshot, (index + 1, index + 1))
(snapshots / "evidence-only").mkdir()
PY

python3 "$REPO_DIR/scripts/m6-ship/prune-legacy-backups.py" \
  --backup-root "$TEST_ROOT/legacy" --retention 3 >/dev/null
[[ "$(find "$TEST_ROOT/legacy/state" -type f | wc -l | tr -d ' ')" == "10" ]]
python3 "$REPO_DIR/scripts/m6-ship/prune-legacy-backups.py" \
  --backup-root "$TEST_ROOT/legacy" --retention 3 --apply >/dev/null
[[ "$(find "$TEST_ROOT/legacy/state" -type f | wc -l | tr -d ' ')" == "6" ]]
[[ "$(find "$TEST_ROOT/legacy/agent-snapshots" -mindepth 1 -maxdepth 1 -type d -name 'deploy-pre-*' | wc -l | tr -d ' ')" == "3" ]]
[[ -d "$TEST_ROOT/legacy/agent-snapshots/evidence-only" ]]

echo "backup-library-state: pass"
