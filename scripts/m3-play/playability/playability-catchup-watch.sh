#!/usr/bin/env bash
# Auto catch-up after an idle-gated deferred or aborted nightly refresh.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
OPS_DIR="${CACHE_DIR}/ops"
STATE_PATH="${MANGO_GROW_RUN_STATE_PATH:-$CACHE_DIR/grow-run-state.json}"
STAMP_PATH="${MANGO_PLAYABILITY_CATCHUP_STAMP:-$CACHE_DIR/playability-catchup-watch.last}"
LOCK_FILE="${CACHE_DIR}/playability-maintenance.lock"
PIDFILE="${CACHE_DIR}/nightly-library-refresh.pid"
RELIABILITY_DIR="${MANGO_RELIABILITY_DIR:-/etc/mango/reliability}"
PROOF_PATH="${MANGO_RELIABILITY_PROOF_PATH:-$RELIABILITY_DIR/proofs.jsonl}"
RECENT_HOURS="${MANGO_PLAYABILITY_CATCHUP_RECENT_HOURS:-18}"
COOLDOWN_HOURS="${MANGO_PLAYABILITY_CATCHUP_COOLDOWN_HOURS:-8}"
DRY_RUN=0
MODE="${MANGO_PLAYABILITY_CATCHUP_MODE:-nightly}"

usage() {
  cat <<EOF
usage: $0 [--dry-run] [--mode nightly|grow|stale]

Checks for a recent deferred/aborted playability refresh OR a reliability
proof that is yellow because of a playability/grow problem, verifies the
couch is idle, and runs playability-catch-up.sh once the catch-up cooldown
has elapsed.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --mode) MODE="${2:-nightly}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

case "$MODE" in
  nightly|grow|stale) ;;
  *) echo "mode must be nightly, grow, or stale (got: $MODE)" >&2; exit 2 ;;
esac

cd "$REPO_DIR"
mkdir -p "$CACHE_DIR" "$OPS_DIR"

lock_busy() (
  if command -v flock >/dev/null 2>&1; then
    exec 201>"$LOCK_FILE"
    ! flock -n 201
    return
  fi
  python3 - "$LOCK_FILE" <<'PY'
import fcntl
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
with path.open("a+", encoding="utf-8") as handle:
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit(0)
    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
raise SystemExit(1)
PY
)

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "catchup-watch: skip nightly refresh already running"
  exit 0
fi

if lock_busy || pgrep -f '[p]layability-indexer.ts' >/dev/null 2>&1; then
  echo "catchup-watch: skip playability maintenance already running"
  exit 0
fi

if ! bash "$REPO_DIR/scripts/lib/couch-activity.sh" is-idle >/dev/null 2>&1; then
  echo "catchup-watch: skip couch active"
  exit 0
fi

decision="$(
  python3 - "$OPS_DIR" "$STATE_PATH" "$STAMP_PATH" "$RECENT_HOURS" "$COOLDOWN_HOURS" "$PROOF_PATH" <<'PY'
import json
import time
from pathlib import Path
import sys

ops_dir = Path(sys.argv[1])
state_path = Path(sys.argv[2])
stamp_path = Path(sys.argv[3])
recent_hours = float(sys.argv[4])
cooldown_hours = float(sys.argv[5])
proof_path = Path(sys.argv[6])
now = time.time()
recent_cutoff = now - recent_hours * 3600
cooldown_cutoff = now - cooldown_hours * 3600


def load_json(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def payload_time(path: Path, payload: dict) -> float:
    for key in ("finished_at", "updated_at", "started_at"):
        value = payload.get(key)
        if isinstance(value, str):
            try:
                from datetime import datetime

                return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
            except Exception:
                pass
    for key in ("finished_at", "updated_at_ms", "started_at"):
        value = payload.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return value / 1000 if value > 10_000_000_000 else value
    try:
        return path.stat().st_mtime
    except OSError:
        return 0


def print_result(action: str, **fields: object) -> None:
    parts = [f"action={action}"]
    parts.extend(f"{key}={value}" for key, value in fields.items())
    print(" ".join(parts))


if stamp_path.is_file() and stamp_path.stat().st_mtime > cooldown_cutoff:
    age_hours = round((now - stamp_path.stat().st_mtime) / 3600, 2)
    print_result("skip", reason="cooldown", last_catchup_age_hours=age_hours)
    raise SystemExit(0)

signals: list[tuple[float, str, Path]] = []
for path in sorted(ops_dir.glob("refresh-*-deferred.json")):
    payload = load_json(path)
    when = payload_time(path, payload)
    if when >= recent_cutoff:
        signals.append((when, "deferred_report", path))

state = load_json(state_path)
state_when = payload_time(state_path, state) if state else 0
if state and state_when >= recent_cutoff:
    phase = str(state.get("phase") or state.get("stage") or "")
    message = str(state.get("message") or "")
    if phase == "deferred" or "deferred" in message.lower():
        signals.append((state_when, "deferred_state", state_path))
    elif phase not in {"done", "restore"}:
        signals.append((state_when, f"incomplete_state_{phase or 'unknown'}", state_path))

for path in sorted(ops_dir.glob("refresh-*.json")):
    if path.name.endswith("-deferred.json"):
        continue
    payload = load_json(path)
    when = payload_time(path, payload)
    if when < recent_cutoff:
        continue
    rc = payload.get("maintenance_rc")
    if rc is None:
        rc = payload.get("rc")
    category = str(payload.get("failure_category") or "")
    ok = payload.get("ok")
    if rc not in (None, 0) or ok is False or category:
        signals.append((when, f"failed_refresh_rc_{rc if rc is not None else 'unknown'}", path))


def load_latest_reliability_proof(path: Path) -> dict:
    """Latest record (by generated_at) from the append-only proofs.jsonl ledger."""
    if not path.is_file():
        return {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}
    latest: dict = {}
    latest_at = -1.0
    for line in lines[-500:]:
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(record, dict):
            continue
        at = record.get("generated_at")
        if isinstance(at, (int, float)) and at > latest_at:
            latest_at = at
            latest = record
    return latest


# H7: a reliability proof that is yellow because of a stuck/failed nightly
# playability refresh (see reliability/model.ts playabilityRefreshFailure) is
# itself a trigger to catch up, even without a deferred/aborted refresh JSON
# on disk (e.g. after a service restart cleared the ops cache).
latest_proof = load_latest_reliability_proof(proof_path)
if latest_proof:
    proof_status = latest_proof.get("status")
    proof_at = latest_proof.get("generated_at")
    proof_metadata = latest_proof.get("metadata")
    if not isinstance(proof_metadata, dict):
        proof_metadata = {}
    playability_rc = proof_metadata.get("playability_rc")
    playability_ok = proof_metadata.get("playability_ok")
    proof_failure_category = proof_metadata.get("failure_category")
    playability_cause = (
        (isinstance(playability_rc, (int, float)) and playability_rc != 0)
        or playability_ok is False
        or bool(proof_failure_category)
    )
    if (
        proof_status == "yellow"
        and playability_cause
        and isinstance(proof_at, (int, float))
        and proof_at / 1000 >= recent_cutoff
    ):
        signals.append((proof_at / 1000, "proof_yellow_playability", proof_path))

if not signals:
    print_result("skip", reason="no_recent_abort_or_deferred")
    raise SystemExit(0)

when, reason, path = max(signals, key=lambda item: item[0])
print_result("run", reason=reason, signal_path=path, signal_age_hours=round((now - when) / 3600, 2))
PY
)"

echo "catchup-watch: $decision"
if [[ "$decision" != action=run* ]]; then
  exit 0
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "catchup-watch: dry-run would run playability-catch-up.sh $MODE"
  exit 0
fi

bash "$REPO_DIR/scripts/m3-play/playability/playability-catch-up.sh" "$MODE"
date +%s >"$STAMP_PATH"
echo "catchup-watch: catch-up complete mode=$MODE"
