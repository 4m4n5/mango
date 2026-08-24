#!/usr/bin/env bash
# Prune Mango SQLite generation history and compact library.db.
# Stops catalog-service only (does not run mango-stack.sh, so it will not
# copy a bloated library.db into state backups). Restores catalog after.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/catalog-service-stack.sh
source "$REPO_DIR/scripts/lib/catalog-service-stack.sh"

VACUUM=0
if [[ "${1:-}" == "--vacuum" ]]; then
  VACUUM=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--vacuum]" >&2
  exit 2
fi

python_prune="$REPO_DIR/scripts/m6-ship/prune-mango-sqlite.py"
node_prune="$REPO_DIR/src/catalog-service/dist/library/prune-cli.js"
if [[ ! -f "$python_prune" && ! -f "$node_prune" ]]; then
  echo "prune helper missing; pull main or build catalog-service" >&2
  exit 1
fi

watchdog_enabled=0
if command -v systemctl >/dev/null 2>&1 \
  && systemctl --user is-enabled mango-watchdog.timer >/dev/null 2>&1; then
  watchdog_enabled=1
fi
vod_worker_was_active=0
if command -v systemctl >/dev/null 2>&1 \
  && systemctl --user is-enabled mango-vod-recs-worker.service >/dev/null 2>&1; then
  vod_worker_was_active=1
fi

restore_services() {
  start_catalog_service_only || true
  if [[ "$vod_worker_was_active" == "1" ]]; then
    systemctl --user start mango-vod-recs-worker.service >/dev/null 2>&1 || true
  fi
  if [[ "$watchdog_enabled" == "1" ]]; then
    systemctl --user start mango-watchdog.timer >/dev/null 2>&1 || true
  fi
}
trap restore_services EXIT

echo "creating verified SQLite backup before prune"
bash "$REPO_DIR/scripts/m6-ship/backup-library-state.sh" --quiet

if [[ "$watchdog_enabled" == "1" ]]; then
  echo "stopping watchdog so it cannot restart catalog mid-prune"
  systemctl --user stop mango-watchdog.timer mango-watchdog.service 2>/dev/null || true
fi

if [[ "$vod_worker_was_active" == "1" ]]; then
  echo "stopping isolated VOD recommendation worker for exclusive prune"
  systemctl --user stop mango-vod-recs-worker.service
fi

# A manually started worker is not owned by the systemd unit. Refuse to
# compact while its live PID still owns the worker lease.
worker_lease="${MANGO_VOD_RECS_WORKER_LEASE:-${MANGO_VOD_RECS_WORKER_LEASE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/mango}/vod-recs-worker.lease}"
if ! python3 - "$worker_lease" <<'PY'
import json
import os
from pathlib import Path
import sys

path = Path(sys.argv[1])
if not path.is_file():
    raise SystemExit(0)
try:
    pid = int(json.loads(path.read_text(encoding="utf-8")).get("pid", 0))
except (OSError, ValueError, TypeError, json.JSONDecodeError):
    raise SystemExit(0)
if pid <= 0:
    raise SystemExit(0)
try:
    os.kill(pid, 0)
except ProcessLookupError:
    raise SystemExit(0)
except PermissionError:
    pass
raise SystemExit(1)
PY
then
  echo "refusing prune: VOD recommendation worker lease still has a live owner" >&2
  exit 1
fi

echo "stopping catalog-service for exclusive prune"
stop_catalog_service_only

if [[ -f "$python_prune" ]]; then
  args=(
    --apply
    --library "${MANGO_LIBRARY_DB_PATH:-/etc/mango/library.db}"
    --playability "${MANGO_PLAYABILITY_DB_PATH:-/etc/mango/playability.db}"
    --youtube "${MANGO_YOUTUBE_DB_PATH:-/etc/mango/youtube.db}"
  )
  if [[ "$VACUUM" == "1" ]]; then
    args+=(--vacuum)
  fi
  python3 "$python_prune" "${args[@]}"
else
  cd "$REPO_DIR/src/catalog-service"
  args=()
  if [[ "$VACUUM" == "1" ]]; then
    args+=(--vacuum)
  fi
  node "$node_prune" "${args[@]}"
fi

python3 - "${MANGO_LIBRARY_DB_PATH:-/etc/mango/library.db}" <<'PY'
from pathlib import Path
import sqlite3
import sys

path = Path(sys.argv[1])
if not path.is_file():
    raise SystemExit(f"library database missing after prune: {path}")
connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
try:
    result = connection.execute("PRAGMA quick_check").fetchone()
finally:
    connection.close()
if result is None or result[0] != "ok":
    raise SystemExit(f"library quick_check failed after prune: {result}")
PY

echo "starting catalog-service"
trap - EXIT
start_catalog_service_only
if [[ "$vod_worker_was_active" == "1" ]]; then
  systemctl --user start mango-vod-recs-worker.service
fi
if [[ "$watchdog_enabled" == "1" ]]; then
  systemctl --user start mango-watchdog.timer >/dev/null 2>&1 || true
fi
