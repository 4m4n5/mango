#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
export XDG_CACHE_HOME="$TMP_DIR/cache"
LOCK="$XDG_CACHE_HOME/mango/playability-maintenance.lock"
READY="$TMP_DIR/ready"
RELEASE="$TMP_DIR/release"
mkdir -p "$(dirname "$LOCK")"

python3 - "$LOCK" "$READY" "$RELEASE" <<'PY' &
import fcntl
import os
import sys
import time

lock, ready, release = sys.argv[1:]
with open(lock, "a+", encoding="utf-8") as handle:
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    with open(ready, "w", encoding="utf-8") as out:
        out.write(str(os.fstat(handle.fileno()).st_ino))
    while not os.path.exists(release):
        time.sleep(0.02)
PY
HOLDER_PID=$!

for _ in $(seq 1 100); do
  [[ -f "$READY" ]] && break
  sleep 0.02
done
[[ -f "$READY" ]]
HELD_INODE="$(cat "$READY")"

bash "$REPO_DIR/scripts/lib/stale-flock-cleanup.sh" >/dev/null
[[ -f "$LOCK" ]]
[[ "$(python3 -c 'import os,sys; print(os.stat(sys.argv[1]).st_ino)' "$LOCK")" == "$HELD_INODE" ]]

set +e
python3 - "$LOCK" <<'PY'
import fcntl
import sys
with open(sys.argv[1], "a+", encoding="utf-8") as handle:
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit(75)
raise SystemExit(0)
PY
RC=$?
set -e
[[ "$RC" -eq 75 ]]

touch "$RELEASE"
wait "$HOLDER_PID"
bash "$REPO_DIR/scripts/lib/stale-flock-cleanup.sh" >/dev/null
[[ -f "$LOCK" ]]

echo "PASS: stable flock path is never unlinked"
