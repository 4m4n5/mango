#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP_DIR="$(mktemp -d)"
HOLDER_PID=""
RELEASE=""
cleanup() {
  if [[ -n "${HOLDER_PID:-}" ]] && kill -0 "$HOLDER_PID" >/dev/null 2>&1; then
    [[ -n "${RELEASE:-}" ]] && touch "$RELEASE" 2>/dev/null || true
    wait "$HOLDER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT
export MANGO_REPO_DIR="$REPO_DIR"
export XDG_CACHE_HOME="$TMP_DIR/cache"
export MANGO_PLAYABILITY_COORDINATOR_TEST_ONLY=1

bash "$REPO_DIR/scripts/m3-play/playability/playability-grow.sh" --mode grow --preset nightly >/dev/null
bash "$REPO_DIR/scripts/m3-play/playability/nightly-library-refresh.sh" --mode nightly --preset nightly >/dev/null
bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode stale >/dev/null

python3 - "$XDG_CACHE_HOME/mango/playability-runs" <<'PY'
import json
import sys
from pathlib import Path

runs = Path(sys.argv[1])
receipts = [
    json.loads(path.read_text(encoding="utf-8"))
    for path in runs.glob("*.json")
    if path.name != "active.json" and not path.name.endswith(".claim.json")
]
levels = {receipt.get("level") for receipt in receipts}
expected = {"grow_standard", "grow_nightly", "stale_refresh"}
if levels != expected:
    raise SystemExit(f"unexpected coordinated levels: {levels} expected={expected}")
if any(receipt.get("state") != "succeeded" for receipt in receipts):
    raise SystemExit(f"non-terminal coordinator receipt: {receipts}")
PY

grow_deadline="$(env -u MANGO_GROW_PRESET \
  MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1 \
  MANGO_MAINTENANCE_DEADLINE_TEST_ONLY=1 \
  bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode grow)"
nightly_deadline="$(env -u MANGO_GROW_PRESET \
  MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1 \
  MANGO_MAINTENANCE_DEADLINE_TEST_ONLY=1 \
  bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode nightly)"
python3 - "$grow_deadline" "$nightly_deadline" <<'PY'
import json
import sys
grow = json.loads(sys.argv[1])
nightly = json.loads(sys.argv[2])
grow_window = grow["admission_deadline_ms"] - (grow["deadline_ms"] - 150 * 60 * 1000)
nightly_stop_before_deadline = nightly["deadline_ms"] - nightly["admission_deadline_ms"]
if grow["preset"] != "quick" or grow_window != 8 * 60 * 1000:
    raise SystemExit(f"grow default preset/deadline wrong: {grow}")
if nightly["preset"] != "nightly" or nightly_stop_before_deadline != 15 * 60 * 1000:
    raise SystemExit(f"nightly default preset/deadline wrong: {nightly}")
PY

RUNS_DIR="$XDG_CACHE_HOME/mango/playability-runs"
cat >"$RUNS_DIR/active.json" <<'JSON'
{"level":"grow_nightly","pid":99999999,"policy_hash":"active-policy","run_id":"playability-stale-claim","state":"claimed","updated_at":1}
JSON
cat >"$RUNS_DIR/playability-stale-claim.json" <<'JSON'
{"level":"grow_nightly","pid":99999999,"policy_hash":"old-policy","run_id":"playability-stale-claim","state":"claimed","updated_at":1}
JSON
bash "$REPO_DIR/scripts/m3-play/playability/playability-coordinator.sh" \
  --run-id playability-new-recovery --level grow_quick >/dev/null
python3 - "$RUNS_DIR" <<'PY'
import json
import sys
from pathlib import Path
runs = Path(sys.argv[1])
old = json.loads((runs / "playability-stale-claim.json").read_text(encoding="utf-8"))
if old.get("state") != "failed" or old.get("exit_code") != 130:
    raise SystemExit(f"stale claim was not persisted as interrupted failure: {old}")
if old.get("failure_category") != "interrupted" or old.get("failure_reason") != "coordinator_lock_recovered":
    raise SystemExit(f"missing interrupted reason: {old}")
if old.get("policy_hash") != "old-policy":
    raise SystemExit(f"old receipt metadata not preserved: {old}")
active = json.loads((runs / "active.json").read_text(encoding="utf-8"))
if active.get("run_id") != "playability-new-recovery" or active.get("state") != "succeeded":
    raise SystemExit(f"new active receipt not terminal: {active}")
PY

cat >"$RUNS_DIR/active.json" <<'JSON'
{"level":"grow_nightly","pid":99999999,"run_id":"playability-already-terminal","state":"claimed","updated_at":1}
JSON
cat >"$RUNS_DIR/playability-already-terminal.json" <<'JSON'
{"level":"grow_nightly","run_id":"playability-already-terminal","state":"succeeded","updated_at":2}
JSON
bash "$REPO_DIR/scripts/m3-play/playability/playability-coordinator.sh" \
  --run-id playability-terminal-preserved --level grow_quick >/dev/null
python3 - "$RUNS_DIR/playability-already-terminal.json" <<'PY'
import json
import sys
receipt = json.load(open(sys.argv[1], encoding="utf-8"))
if receipt.get("state") != "succeeded" or receipt.get("exit_code") is not None:
    raise SystemExit(f"terminal stale receipt was overwritten: {receipt}")
PY

cat >"$RUNS_DIR/active.json" <<'JSON'
{"level":"grow_nightly","pid":99999999,"run_id":"../bad-run","state":"claimed","updated_at":1}
JSON
bash "$REPO_DIR/scripts/m3-play/playability/playability-coordinator.sh" \
  --run-id playability-invalid-active --level grow_quick >/dev/null
[[ ! -f "$XDG_CACHE_HOME/mango/bad-run.json" ]]

cat >"$RUNS_DIR/active.json" <<'JSON'
{"level":"grow_nightly","pid":99999999,"run_id":"playability-mismatched","state":"claimed","updated_at":1}
JSON
cat >"$RUNS_DIR/playability-mismatched.json" <<'JSON'
{"level":"grow_nightly","run_id":"playability-other","state":"claimed","updated_at":1}
JSON
bash "$REPO_DIR/scripts/m3-play/playability/playability-coordinator.sh" \
  --run-id playability-mismatch-preserved --level grow_quick >/dev/null
python3 - "$RUNS_DIR/playability-mismatched.json" <<'PY'
import json
import sys
receipt = json.load(open(sys.argv[1], encoding="utf-8"))
if receipt.get("run_id") != "playability-other" or receipt.get("state") != "claimed":
    raise SystemExit(f"mismatched receipt was overwritten: {receipt}")
PY

cat >"$RUNS_DIR/active.json" <<'JSON'
{"level":"grow_nightly","pid":99999999,"run_id":"playability-busy-old","state":"claimed","updated_at":1}
JSON
cat >"$RUNS_DIR/playability-busy-old.json" <<'JSON'
{"level":"grow_nightly","run_id":"playability-busy-old","state":"busy","updated_at":1}
JSON
bash "$REPO_DIR/scripts/m3-play/playability/playability-coordinator.sh" \
  --run-id playability-busy-preserved --level grow_quick >/dev/null
python3 - "$RUNS_DIR/playability-busy-old.json" <<'PY'
import json
import sys
receipt = json.load(open(sys.argv[1], encoding="utf-8"))
if receipt.get("state") != "busy" or receipt.get("exit_code") is not None:
    raise SystemExit(f"non-claimed stale receipt was overwritten: {receipt}")
PY

cat >"$RUNS_DIR/active.json" <<'JSON'
["corrupt", "receipt"]
JSON
bash "$REPO_DIR/scripts/m3-play/playability/playability-coordinator.sh" \
  --run-id playability-corrupt-active --level grow_quick >/dev/null

cat >"$RUNS_DIR/active.json" <<'JSON'
{"level":"grow_nightly","pid":99999999,"run_id":"playability-corrupt-time","state":"claimed","updated_at":["bad"]}
JSON
cat >"$RUNS_DIR/playability-corrupt-time.json" <<'JSON'
{"level":"grow_nightly","run_id":"playability-corrupt-time","state":"claimed","updated_at":1}
JSON
bash "$REPO_DIR/scripts/m3-play/playability/playability-coordinator.sh" \
  --run-id playability-corrupt-time-recovered --level grow_quick >/dev/null
python3 - "$RUNS_DIR/playability-corrupt-time.json" <<'PY'
import json
import sys
receipt = json.load(open(sys.argv[1], encoding="utf-8"))
if receipt.get("state") != "failed" or receipt.get("failure_category") != "interrupted":
    raise SystemExit(f"corrupt timestamp receipt was not recovered: {receipt}")
PY

cat >"$RUNS_DIR/active.json" <<'JSON'
{"level":"grow_nightly","pid":99999999,"run_id":"playability-old-busy","state":"claimed","updated_at":1}
JSON
LOCK_FILE="$XDG_CACHE_HOME/mango/playability-maintenance.lock"
READY="$TMP_DIR/busy-ready"
RELEASE="$TMP_DIR/busy-release"
python3 - "$LOCK_FILE" "$READY" "$RELEASE" <<'PY' &
import fcntl
import json
import os
import sys
import time

lock_file, ready, release = sys.argv[1:]
fd = os.open(lock_file, os.O_RDWR | os.O_CREAT | os.O_APPEND, 0o600)
with os.fdopen(fd, "r+", encoding="utf-8") as handle:
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    handle.seek(0)
    handle.truncate()
    json.dump({"run_id": "playability-current-owner", "level": "grow_quick", "claimed_at": int(time.time() * 1000)}, handle)
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
    Path = __import__("pathlib").Path
    Path(ready).write_text("ready", encoding="utf-8")
    deadline = time.time() + 20
    while not os.path.exists(release) and time.time() < deadline:
        time.sleep(0.02)
PY
HOLDER_PID=$!
for _ in $(seq 1 100); do
  [[ -f "$READY" ]] && break
  sleep 0.02
done
[[ -f "$READY" ]]
set +e
bash "$REPO_DIR/scripts/m3-play/playability/playability-coordinator.sh" \
  --run-id playability-busy-contender --level grow_quick >/dev/null
BUSY_RC=$?
set -e
touch "$RELEASE"
wait "$HOLDER_PID"
HOLDER_PID=""
[[ "$BUSY_RC" -eq 75 ]]
python3 - "$RUNS_DIR/playability-busy-contender.claim.json" <<'PY'
import json
import sys
claim = json.load(open(sys.argv[1], encoding="utf-8"))
if claim.get("state") != "busy" or claim.get("active_run_id") != "playability-current-owner":
    raise SystemExit(f"busy contender returned stale owner: {claim}")
PY

echo "PASS: familiar playability entrypoints delegate before side effects"
