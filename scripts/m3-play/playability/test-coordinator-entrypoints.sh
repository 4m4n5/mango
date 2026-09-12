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
nightly_stale_window = nightly["stale_child_admission_deadline_ms"] - nightly["started_ms"]
nightly_global_window = nightly["admission_deadline_ms"] - nightly["started_ms"]
if grow["preset"] != "quick" or grow_window != 8 * 60 * 1000:
    raise SystemExit(f"grow default preset/deadline wrong: {grow}")
if nightly["preset"] != "nightly" or nightly_stop_before_deadline != 15 * 60 * 1000:
    raise SystemExit(f"nightly default preset/deadline wrong: {nightly}")
if nightly["grow_child_admission_deadline_ms"] != nightly["admission_deadline_ms"]:
    raise SystemExit(f"nightly grow child deadline was narrowed: {nightly}")
if nightly["stale_budget_fraction"] != 0.5 or nightly_stale_window != int(nightly_global_window * 0.5):
    raise SystemExit(f"nightly stale budget fraction not applied: {nightly}")
for payload in (grow, nightly):
    if payload["hooks_child_admission_deadline_ms"] != payload["stale_child_admission_deadline_ms"]:
        raise SystemExit(f"live trigger hooks escaped stale admission allocation: {payload}")
PY

inherited_long_quick_deadline="$(env -u MANGO_GROW_PRESET \
  MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1 \
  MANGO_MAINTENANCE_DEADLINE_TEST_ONLY=1 \
  MANGO_PLAYABILITY_ADMISSION_DEADLINE_MS=9999999999999 \
  bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode grow)"
inherited_inverted_deadline="$(env -u MANGO_GROW_PRESET \
  MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1 \
  MANGO_MAINTENANCE_DEADLINE_TEST_ONLY=1 \
  MANGO_PLAYABILITY_RUN_DEADLINE_MS=1000 \
  MANGO_PLAYABILITY_ADMISSION_DEADLINE_MS=2000 \
  bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode nightly)"
python3 - "$inherited_long_quick_deadline" "$inherited_inverted_deadline" <<'PY'
import json
import sys

quick = json.loads(sys.argv[1])
inverted = json.loads(sys.argv[2])
quick_window = quick["admission_deadline_ms"] - quick["started_ms"]
if quick["preset"] != "quick" or quick_window != 8 * 60 * 1000:
    raise SystemExit(f"inherited long quick deadline was not bounded: {quick}")
if inverted["admission_deadline_ms"] <= inverted["started_ms"]:
    raise SystemExit(f"inherited inverted deadline survived: {inverted}")
if inverted["deadline_ms"] <= inverted["admission_deadline_ms"]:
    raise SystemExit(f"inherited inverted run/admission ordering survived: {inverted}")
PY

make_policy() {
  local fraction="$1"
  local path="$2"
  python3 - "$REPO_DIR/config/playability-policy.json" "$path" "$fraction" <<'PY'
import json
import sys

source, target, fraction = sys.argv[1:]
data = json.load(open(source, encoding="utf-8"))
data["nightly"]["stale_budget_fraction"] = float(fraction)
with open(target, "w", encoding="utf-8") as handle:
    json.dump(data, handle)
PY
}

for preset in quick nightly overnight; do
  absolute_deadline="$(MANGO_GROW_PRESET="$preset" \
    MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1 \
    MANGO_MAINTENANCE_DEADLINE_TEST_ONLY=1 \
    MANGO_PLAYABILITY_ABSOLUTE_RUN_DEADLINE_MS=2000 \
    MANGO_PLAYABILITY_ABSOLUTE_ADMISSION_DEADLINE_MS=1000 \
    bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode stale)"
  python3 - "$absolute_deadline" <<'PY'
import json, sys
p = json.loads(sys.argv[1])
assert p['deadline_ms'] == 2000, p
assert p['admission_deadline_ms'] == 1000, p
assert p['hooks_child_admission_deadline_ms'] == 1000, p
PY
done
future_cap="$(MANGO_GROW_PRESET=quick \
  MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1 \
  MANGO_MAINTENANCE_DEADLINE_TEST_ONLY=1 \
  MANGO_PLAYABILITY_ABSOLUTE_RUN_DEADLINE_MS=9007199254740991 \
  MANGO_PLAYABILITY_ABSOLUTE_ADMISSION_DEADLINE_MS=9007199254740991 \
  bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode grow)"
run_only_cap="$(MANGO_GROW_PRESET=nightly \
  MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1 \
  MANGO_MAINTENANCE_DEADLINE_TEST_ONLY=1 \
  MANGO_PLAYABILITY_ABSOLUTE_RUN_DEADLINE_MS=2000 \
  bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode nightly)"
python3 - "$future_cap" "$run_only_cap" <<'PY'
import json, sys
future, run_only = map(json.loads, sys.argv[1:])
assert future['admission_deadline_ms'] - future['started_ms'] == 8 * 60 * 1000, future
assert future['deadline_ms'] - future['started_ms'] == 150 * 60 * 1000, future
assert run_only['deadline_ms'] == run_only['admission_deadline_ms'] == 2000, run_only
assert run_only['hooks_child_admission_deadline_ms'] <= 2000, run_only
PY
for invalid in -1 0 nan 1.5 9007199254740992; do
  if MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1 \
    MANGO_MAINTENANCE_DEADLINE_TEST_ONLY=1 \
    MANGO_PLAYABILITY_ABSOLUTE_RUN_DEADLINE_MS="$invalid" \
    bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode stale \
    >"$TMP_DIR/absolute-bad.out" 2>"$TMP_DIR/absolute-bad.err"; then
    echo "invalid absolute deadline accepted: $invalid" >&2
    exit 1
  fi
done

for fraction in 0 0.25 0.5; do
  policy_path="$TMP_DIR/policy-$fraction.json"
  make_policy "$fraction" "$policy_path"
  budget_deadline="$(env -u MANGO_GROW_PRESET \
    MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1 \
    MANGO_MAINTENANCE_DEADLINE_TEST_ONLY=1 \
    MANGO_PLAYABILITY_POLICY_PATH="$policy_path" \
    bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode nightly)"
  python3 - "$budget_deadline" "$fraction" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
fraction = float(sys.argv[2])
global_window = payload["admission_deadline_ms"] - payload["started_ms"]
expected = payload["started_ms"] + int(global_window * fraction)
if payload["stale_child_admission_deadline_ms"] != min(payload["admission_deadline_ms"], expected):
    raise SystemExit(f"stale child deadline mismatch for {fraction}: {payload}")
if payload["grow_child_admission_deadline_ms"] != payload["admission_deadline_ms"]:
    raise SystemExit(f"grow child deadline changed for {fraction}: {payload}")
if payload["hooks_child_admission_deadline_ms"] != payload["stale_child_admission_deadline_ms"]:
    raise SystemExit(f"live hooks ignored stale budget for {fraction}: {payload}")
PY
done

policy_path="$TMP_DIR/policy-stale-mode.json"
make_policy 0.25 "$policy_path"
stale_mode_deadline="$(env -u MANGO_GROW_PRESET \
  MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1 \
  MANGO_MAINTENANCE_DEADLINE_TEST_ONLY=1 \
  MANGO_PLAYABILITY_POLICY_PATH="$policy_path" \
  bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode stale)"
python3 - "$stale_mode_deadline" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if payload["stale_child_admission_deadline_ms"] != payload["admission_deadline_ms"]:
    raise SystemExit(f"explicit stale mode should keep full allocation: {payload}")
if payload["grow_child_admission_deadline_ms"] != payload["admission_deadline_ms"]:
    raise SystemExit(f"explicit stale mode changed grow child deadline: {payload}")
if payload["hooks_child_admission_deadline_ms"] != payload["admission_deadline_ms"]:
    raise SystemExit(f"explicit stale hooks should keep full allocation: {payload}")
PY

bad_policy="$TMP_DIR/policy-bad-fraction.json"
make_policy 0.75 "$bad_policy"
if env -u MANGO_GROW_PRESET \
    MANGO_PLAYABILITY_COORDINATOR_LOCK_HELD=1 \
    MANGO_MAINTENANCE_DEADLINE_TEST_ONLY=1 \
    MANGO_PLAYABILITY_POLICY_PATH="$bad_policy" \
    bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode nightly \
    >"$TMP_DIR/bad-policy.out" 2>"$TMP_DIR/bad-policy.err"; then
  echo "invalid stale_budget_fraction was accepted" >&2
  exit 1
fi
grep -q 'stale_budget_fraction' "$TMP_DIR/bad-policy.err"

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
