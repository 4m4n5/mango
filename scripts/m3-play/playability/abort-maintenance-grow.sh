#!/usr/bin/env bash
# Abort an in-flight grow/maintenance and restore the couch stack.
#
#   bash scripts/m3-play/playability/abort-maintenance-grow.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
cd "$REPO_DIR"

echo "abort: stopping playability grow/maintenance"

stop_pidfile() {
  local path="$1"
  local pid
  if [[ ! -f "$path" ]]; then
    return 0
  fi
  pid="$(cat "$path" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$path"
}

stop_pidfile "$CACHE_DIR/playability-grow.pid"
stop_pidfile "$CACHE_DIR/overnight-fill.pid"

pkill -f '[p]layability-grow.sh' 2>/dev/null || true
pkill -f '[p]layability-indexer.ts' 2>/dev/null || true
pkill -f '[p]layability-maintenance.sh' 2>/dev/null || true
pkill -f '[o]vernight-playability-grow.sh' 2>/dev/null || true
pkill -f '[s]ource-hitrate.py' 2>/dev/null || true
bash scripts/m3-play/playability/mpv-probe-pool.sh stop-all >/dev/null 2>&1 || true
rm -f "$CACHE_DIR/playability-maintenance.lock"
rm -f "$CACHE_DIR/overnight-fill.lock"
bash scripts/lib/stale-flock-cleanup.sh >/dev/null 2>&1 || true

python3 - <<'PY' || true
import json
import os
import time
from pathlib import Path

root = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "mango"
state_path = root / "grow-run-state.json"
try:
    state = json.loads(state_path.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError):
    state = {}

run_id = state.get("run_id")
if run_id:
    payload = {
        "ok": False,
        "run_id": run_id,
        "mode": state.get("mode"),
        "preset": state.get("preset"),
        "stage": "aborted",
        "failure_category": "grow_aborted",
        "duration_ms": None,
        "error": "Maintenance grow was aborted so the couch stack could be restored.",
        "repair_suggestions": [
            "Run a fresh grow after deploy/restart work is complete.",
            "Assess only refresh JSON written after the current grow baseline.",
        ],
        "run_state": state,
        "finished_at_ms": int(time.time() * 1000),
    }
    ops_dir = root / "ops"
    ops_dir.mkdir(parents=True, exist_ok=True)
    out = ops_dir / f"refresh-{run_id}.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

RUN_ID="$(python3 - "$CACHE_DIR/grow-run-state.json" <<'PY' 2>/dev/null || true
import json
import sys
from pathlib import Path
state_path = Path(sys.argv[1])
try:
    state = json.loads(state_path.read_text(encoding="utf-8"))
except Exception:
    state = {}
print(state.get("run_id") or "")
PY
)"
if [[ -n "$RUN_ID" && -f "$CACHE_DIR/ops/refresh-${RUN_ID}.json" ]]; then
  python3 scripts/diag/ops-write-run.py \
    --kind playability_maintenance \
    --run-id "$RUN_ID" \
    --source playability-maintenance \
    --write-report \
    --summary "maintenance aborted during couch restore" \
    --payload-file "$CACHE_DIR/ops/refresh-${RUN_ID}.json" >/dev/null 2>&1 || true
fi

python3 scripts/diag/grow_run_state.py set \
  --phase done \
  --message "aborted — couch restore" 2>/dev/null || true

bash scripts/mango-kill-strays.sh >/dev/null 2>&1 || true
MANGO_CATALOG=1 MANGO_PLAYABILITY_TOPUP_ON_START=0 bash scripts/mango-refresh.sh

echo "abort: couch restore complete"
python3 scripts/diag/grow_monitor.py status 2>/dev/null || true
