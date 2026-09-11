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
import re
import sys
import tempfile
import time

lock_file, active_file, result_file, script, run_id, level = sys.argv[1:]
contender_started_at = int(time.time() * 1000)
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$")
TERMINAL_STATES = {"succeeded", "partial", "failed"}

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

def pid_alive(pid):
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True

def read_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def valid_run_id(value):
    return isinstance(value, str) and RUN_ID_RE.match(value) is not None

def terminal_state(value):
    return isinstance(value, str) and value in TERMINAL_STATES

def active_claim_is_current(active):
    if active.get("state") != "claimed":
        return False
    try:
        updated = int(active.get("updated_at") or active.get("claimed_at") or 0)
    except (TypeError, ValueError):
        updated = 0
    pid = active.get("pid")
    return pid_alive(pid) or updated >= contender_started_at - 5000

def recover_interrupted_active_claim(reason):
    active = read_json(active_file)
    if active.get("state") != "claimed":
        return
    active_run_id = active.get("run_id")
    if not valid_run_id(active_run_id):
        return
    run_file = os.path.join(os.path.dirname(active_file), f"{active_run_id}.json")
    existing = read_json(run_file)
    if terminal_state(existing.get("state")):
        return
    if existing.get("run_id") != active_run_id or existing.get("state") != "claimed":
        return
    source = existing if existing else active
    now = int(time.time() * 1000)
    interrupted = dict(source)
    interrupted.update({
        "run_id": active_run_id,
        "level": source.get("level") or active.get("level", ""),
        "state": "failed",
        "previous_state": source.get("state") or active.get("state"),
        "exit_code": 130,
        "failure_category": "interrupted",
        "failure_reason": reason,
        "interrupted": True,
        "interrupted_at": now,
        "updated_at": now,
    })
    durable_json(run_file, interrupted)

fd = os.open(lock_file, os.O_RDWR | os.O_CREAT | os.O_APPEND, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    active_run_id = ""
    for _ in range(500):
        # Prefer the current lock owner. During a handoff, active.json may
        # still describe an interrupted older run until the owner writes its
        # own claimed receipt.
        try:
            with open(lock_file, encoding="utf-8") as handle:
                owner = json.load(handle)
            claimed_at = int(owner.get("claimed_at", 0))
            owner_run_id = owner.get("run_id", "")
            if claimed_at >= contender_started_at - 5000 and valid_run_id(owner_run_id):
                active_run_id = owner_run_id
        except Exception:
            pass
        if not active_run_id:
            active = read_json(active_file)
            current_active_id = active.get("run_id", "")
            if active_claim_is_current(active) and valid_run_id(current_active_id):
                active_run_id = current_active_id
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

recover_interrupted_active_claim("coordinator_lock_recovered")
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
