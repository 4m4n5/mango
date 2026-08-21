#!/usr/bin/env bash
# Best-effort WAL TRUNCATE checkpoint for mango SQLite databases.
#
# In WAL mode the -wal file grows to its autocheckpoint threshold (~4 MB) during
# normal use and passively checkpoints there — that is healthy steady state, not
# a leak. But the -wal file never *shrinks* on its own, so after heavy nightly
# writes (especially youtube.db during the subscription/refresh pass) it can sit
# large on disk while the box is idle. A `wal_checkpoint(TRUNCATE)` reclaims it.
#
# playability.db is already TRUNCATE-checkpointed when a grow publishes its staged
# DB (see playability-maintenance.sh), so the value here is library/progress/youtube.
# We include playability.db too for non-grow nights; it is harmless when already small.
#
# Non-fatal by design: the DBs are opened by the live catalog-service, so if the
# service is mid-write the checkpoint reports busy and is a no-op — the -wal is
# simply reclaimed on a later idle run. Never blocks the nightly pipeline.

set -uo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
BSQLITE="$REPO_DIR/src/catalog-service/node_modules/better-sqlite3"

LIBRARY_DB="${MANGO_LIBRARY_DB_PATH:-/etc/mango/library.db}"
PROGRESS_DB="${MANGO_PROGRESS_DB_PATH:-/etc/mango/progress.db}"
YOUTUBE_DB="${MANGO_YOUTUBE_DB_PATH:-/etc/mango/youtube.db}"
PLAYABILITY_DB="${MANGO_PLAYABILITY_DB:-/etc/mango/playability.db}"

if ! node -e "require('$BSQLITE')" >/dev/null 2>&1; then
  echo "checkpoint-wal-dbs: better-sqlite3 unavailable, skipping" >&2
  exit 0
fi

checkpoint_one() {
  local db="$1"
  if [[ ! -f "$db" ]]; then
    echo "checkpoint-wal-dbs: $db missing, skip"
    return 0
  fi
  local before after
  wal_size() { stat -c '%s' "$1" 2>/dev/null || stat -f '%z' "$1" 2>/dev/null || echo 0; }
  before=$(wal_size "${db}-wal")
  node -e '
    const Database = require(process.argv[1]);
    const path = process.argv[2];
    const db = new Database(path, { timeout: 5000 });
    try {
      const r = db.pragma("wal_checkpoint(TRUNCATE)");
      process.stdout.write(JSON.stringify(r));
    } finally {
      db.close();
    }
  ' "$BSQLITE" "$db" >/tmp/mango-wal-ckpt.json 2>/tmp/mango-wal-ckpt.err
  local rc=$?
  after=$(wal_size "${db}-wal")
  if [[ $rc -eq 0 ]]; then
    echo "checkpoint-wal-dbs: $db wal ${before}B -> ${after}B $(cat /tmp/mango-wal-ckpt.json 2>/dev/null)"
  else
    echo "checkpoint-wal-dbs: $db failed rc=$rc $(cat /tmp/mango-wal-ckpt.err 2>/dev/null)" >&2
  fi
  return 0
}

for db in "$LIBRARY_DB" "$PROGRESS_DB" "$YOUTUBE_DB" "$PLAYABILITY_DB"; do
  checkpoint_one "$db"
done

exit 0
