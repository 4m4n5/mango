#!/usr/bin/env bash
# Inspect stable flock files and remove only dead advisory PID files.
#
# An unheld flock pathname is not stale: the kernel releases flock ownership
# when the last file descriptor closes. Deleting the pathname can split future
# owners across different inodes while an older owner still holds the old one.
set -euo pipefail

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
mkdir -p "$CACHE_DIR"

cleared=0

lock_is_held() {
  local lock="$1"
  python3 - "$lock" <<'PY'
import fcntl
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    with path.open("a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            sys.exit(0)
        finally:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
except OSError:
    sys.exit(0)
sys.exit(1)
PY
}

for lock in "$CACHE_DIR"/*.lock; do
  [[ -f "$lock" ]] || continue
  if lock_is_held "$lock"; then
    echo "stale-flock: held $(basename "$lock")"
  else
    echo "stale-flock: available $(basename "$lock")"
  fi
done

if [[ -f "$CACHE_DIR/overnight-fill.pid" ]]; then
  pid="$(cat "$CACHE_DIR/overnight-fill.pid" 2>/dev/null || true)"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$CACHE_DIR/overnight-fill.pid"
    cleared=$((cleared + 1))
    echo "stale-flock: cleared overnight-fill pid"
  fi
fi

if (( cleared == 0 )); then
  echo "stale-flock: ok"
fi
