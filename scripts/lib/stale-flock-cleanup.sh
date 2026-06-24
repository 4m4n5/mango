#!/usr/bin/env bash
# Remove flock lock files with no live holder (crash leftovers block maintenance).
set -euo pipefail

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
mkdir -p "$CACHE_DIR"

removed=0

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
    continue
  fi
  rm -f "$lock"
  removed=$((removed + 1))
  echo "stale-flock: removed $(basename "$lock")"
done

if [[ -f "$CACHE_DIR/overnight-fill.pid" ]]; then
  pid="$(cat "$CACHE_DIR/overnight-fill.pid" 2>/dev/null || true)"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$CACHE_DIR/overnight-fill.pid" "$CACHE_DIR/overnight-fill.lock"
    removed=$((removed + 1))
    echo "stale-flock: cleared overnight-fill pid"
  fi
fi

if (( removed == 0 )); then
  echo "stale-flock: ok"
fi
