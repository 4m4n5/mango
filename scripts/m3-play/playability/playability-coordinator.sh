#!/usr/bin/env bash
# Single admission point for playability maintenance started by APIs/services.
# The stable flock pathname is never removed.  The lock fd is inherited by the
# selected foreground workflow so ownership spans publish, restart, and readback.

set -uo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
LOCK_FILE="${CACHE_DIR}/playability-maintenance.lock"
RUNS_DIR="${CACHE_DIR}/playability-runs"
ACTIVE_FILE="${RUNS_DIR}/active.json"
RUN_ID=""
LEVEL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --level) LEVEL="${2:-}"; shift 2 ;;
    *) echo "unknown coordinator arg: $1" >&2; exit 2 ;;
  esac
done

if [[ ! "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]]; then
  echo "invalid run id" >&2
  exit 2
fi
case "$LEVEL" in
  stale_refresh|grow_quick|grow_standard|grow_nightly|grow_overnight|fill|diagnostic) ;;
  *) echo "invalid coordinator level: $LEVEL" >&2; exit 2 ;;
esac

mkdir -p "$RUNS_DIR"
POLICY_FILE="${MANGO_PLAYABILITY_POLICY_PATH:-$REPO_DIR/config/playability-policy.json}"
if [[ ! -f "$POLICY_FILE" ]]; then
  echo "playability policy missing: $POLICY_FILE" >&2
  exit 2
fi
export MANGO_PLAYABILITY_POLICY_HASH="$(python3 - "$POLICY_FILE" <<'PY'
import hashlib
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    policy = json.load(handle)
payload = json.dumps(policy, separators=(",", ":"), sort_keys=True).encode()
print(hashlib.sha256(payload).hexdigest())
PY
)"
RESULT_FILE="${RUNS_DIR}/${RUN_ID}.claim.json"
RUN_FILE="${RUNS_DIR}/${RUN_ID}.json"

if [[ "${MANGO_PLAYABILITY_COORDINATOR_INTERNAL_OWNER:-0}" != "1" ]]; then
  exec python3 - "$LOCK_FILE" "$ACTIVE_FILE" "$RESULT_FILE" "$0" "$RUN_ID" "$LEVEL" <<'PY'
import fcntl
import json
import os
import sys
import tempfile
import time

lock_file, active_file, result_file, script, run_id, level = sys.argv[1:]
contender_started_at = int(time.time() * 1000)

def durable_json(target, payload):
    directory = os.path.dirname(target)
    fd, tmp = tempfile.mkstemp(prefix=".playability-run-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"), sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, target)
        dir_fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

fd = os.open(lock_file, os.O_RDWR | os.O_CREAT | os.O_APPEND, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    active_run_id = ""
    for _ in range(500):
        try:
            with open(active_file, encoding="utf-8") as handle:
                active = json.load(handle)
            if active.get("state") == "claimed":
                active_run_id = active.get("run_id", "")
        except Exception:
            pass
        if not active_run_id:
            # The winning process writes its identity into the permanent lock
            # inode immediately after flock.  Only accept this fast-path for a
            # newly contending owner; old contents remain after unlock by
            # design and must never be mistaken for a current owner.
            try:
                with open(lock_file, encoding="utf-8") as handle:
                    owner = json.load(handle)
                claimed_at = int(owner.get("claimed_at", 0))
                if claimed_at >= contender_started_at - 5000:
                    active_run_id = owner.get("run_id", "")
            except Exception:
                pass
        if active_run_id:
            break
        time.sleep(0.01)
    durable_json(result_file, {
        "run_id": run_id,
        "level": level,
        "state": "busy",
        "active_run_id": active_run_id,
        "updated_at": int(time.time() * 1000),
    })
    raise SystemExit(75)

os.ftruncate(fd, 0)
os.lseek(fd, 0, os.SEEK_SET)
os.write(fd, (json.dumps({
    "run_id": run_id,
    "level": level,
    "claimed_at": int(time.time() * 1000),
}, separators=(",", ":"), sort_keys=True) + "\n").encode())
os.fsync(fd)
os.dup2(fd, 200)
os.set_inheritable(200, True)
os.environ["MANGO_PLAYABILITY_COORDINATOR_INTERNAL_OWNER"] = "1"
os.execv("/bin/bash", ["bash", script, "--run-id", run_id, "--level", level])
PY
fi

write_json() {
  local target="$1"
  local state="$2"
  local active_run_id="${3:-}"
  local exit_code="${4:-}"
  python3 - "$target" "$RUN_ID" "$LEVEL" "$state" "$active_run_id" "$exit_code" <<'PY'
import json
import os
import sys
import tempfile
import time

target, run_id, level, state, active_run_id, exit_code = sys.argv[1:]
payload = {
    "run_id": run_id,
    "level": level,
    "state": state,
    "updated_at": int(time.time() * 1000),
    "pid": os.getppid(),
    "policy_hash": os.environ.get("MANGO_PLAYABILITY_POLICY_HASH", ""),
}
if active_run_id:
    payload["active_run_id"] = active_run_id
if exit_code:
    payload["exit_code"] = int(exit_code)
directory = os.path.dirname(target)
fd, tmp = tempfile.mkstemp(prefix=".playability-run-", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"), sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, target)
    dir_fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
finally:
    if os.path.exists(tmp):
        os.unlink(tmp)
PY
}

write_json "$ACTIVE_FILE" claimed
write_json "$RUN_FILE" claimed
write_json "$RESULT_FILE" claimed

export MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1
export MANGO_PLAYABILITY_RUN_ID="$RUN_ID"
export MANGO_OPS_RUN_ID="$RUN_ID"
export MANGO_REPO_DIR="$REPO_DIR"
export MANGO_MAINTENANCE_SKIP_GATE="${MANGO_MAINTENANCE_SKIP_GATE:-1}"

RUN_RC=0
if [[ "${MANGO_PLAYABILITY_COORDINATOR_TEST_HOLD_MS:-0}" =~ ^[0-9]+$ ]] \
    && [[ "${MANGO_PLAYABILITY_COORDINATOR_TEST_HOLD_MS:-0}" -gt 0 ]]; then
  python3 - "${MANGO_PLAYABILITY_COORDINATOR_TEST_HOLD_MS}" <<'PY'
import sys
import time
time.sleep(int(sys.argv[1]) / 1000)
PY
elif [[ "${MANGO_PLAYABILITY_COORDINATOR_TEST_ONLY:-0}" == "1" ]]; then
  :
else
case "$LEVEL" in
  stale_refresh)
    bash "$REPO_DIR/scripts/m3-play/playability/playability-grow.sh" --mode stale --preset nightly || RUN_RC=$?
    ;;
  grow_quick)
    bash "$REPO_DIR/scripts/m3-play/playability/playability-grow.sh" --mode grow --preset quick || RUN_RC=$?
    ;;
  grow_standard)
    bash "$REPO_DIR/scripts/m3-play/playability/playability-grow.sh" --mode grow --preset nightly || RUN_RC=$?
    ;;
  grow_nightly)
    bash "$REPO_DIR/scripts/m3-play/playability/nightly-library-refresh.sh" --mode nightly --preset nightly || RUN_RC=$?
    ;;
  grow_overnight)
    # Keep the established overnight budget without entering the legacy direct-live loop.
    bash "$REPO_DIR/scripts/m3-play/playability/nightly-library-refresh.sh" --mode grow --preset overnight || RUN_RC=$?
    ;;
  fill)
    MANGO_FILL_COORDINATED=1 bash "$REPO_DIR/scripts/m3-play/playability/fill-playability-db.sh" || RUN_RC=$?
    ;;
  diagnostic)
    bash "$REPO_DIR/scripts/diag/probe-one-stream.sh" \
      "${MANGO_PROBE_DIAG_TYPE:-}" "${MANGO_PROBE_DIAG_ID:-}" || RUN_RC=$?
    ;;
esac
fi

if [[ "$RUN_RC" -eq 0 ]]; then
  write_json "$RUN_FILE" succeeded "" "$RUN_RC"
  write_json "$ACTIVE_FILE" succeeded "" "$RUN_RC"
elif [[ "$RUN_RC" -eq 10 ]]; then
  write_json "$RUN_FILE" partial "" "$RUN_RC"
  write_json "$ACTIVE_FILE" partial "" "$RUN_RC"
  exit 0
else
  write_json "$RUN_FILE" failed "" "$RUN_RC"
  write_json "$ACTIVE_FILE" failed "" "$RUN_RC"
fi
exit "$RUN_RC"
