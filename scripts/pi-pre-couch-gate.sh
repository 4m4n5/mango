#!/usr/bin/env bash
# Pre-couch gate — run on Pi before TV testing. Deploy via git pull only (see docs/DEPLOY.md).
# Mac: bash scripts/pi-exec-gate.sh  or  bash scripts/pi-deploy.sh --fast --gate
#
# Default: gate-lite (~1–2 min). Full gate: MANGO_GATE_FULL=1 (~5–8 min, 3 plays/rail).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

echo "=== pre-couch $(hostname) $(git rev-parse --short HEAD 2>/dev/null) ==="

CACHE_MANGO="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
MAINT_LOCK="${CACHE_MANGO}/playability-maintenance.lock"
OVERNIGHT_PID="${CACHE_MANGO}/overnight-fill.pid"
OVERNIGHT_RUNNING=0
if [[ -f "$OVERNIGHT_PID" ]] && kill -0 "$(cat "$OVERNIGHT_PID")" 2>/dev/null; then
  OVERNIGHT_RUNNING=1
fi
MAINT_RUNNING=0
if [[ -f "$MAINT_LOCK" ]]; then
  if python3 - "$MAINT_LOCK" <<'PY'
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
  then
    MAINT_RUNNING=1
  fi
fi
if [[ "$MAINT_RUNNING" -eq 1 ]] || [[ "$OVERNIGHT_RUNNING" -eq 1 ]] || pgrep -f '[p]layability-indexer.ts' >/dev/null 2>&1; then
  echo "FAIL: playability maintenance/grow in progress — couch stack is down" >&2
  echo "  check: python3 scripts/diag/grow_monitor.py watch --exit-when-done" >&2
  echo "  wait for grow to finish, or abort: bash scripts/m3-play/playability/abort-maintenance-grow.sh" >&2
  exit 1
fi

BRANCH="$(git branch --show-current 2>/dev/null || echo main)"
if git fetch origin 2>/dev/null; then
  LOCAL="$(git rev-parse HEAD)"
  REMOTE="$(git rev-parse "origin/${BRANCH}" 2>/dev/null || echo "")"
  [[ -z "$REMOTE" || "$LOCAL" == "$REMOTE" ]] || {
    echo "FAIL: behind origin/${BRANCH} — git pull" >&2
    exit 1
  }
fi

if [[ "$BRANCH" == "feat/native-experience" ]]; then
  if [[ "${MANGO_GATE_FULL:-0}" == "1" ]]; then
    bash scripts/pi-pre-couch-gate-full.sh
    exit $?
  fi
  bash scripts/gate-lite.sh
  echo "PRE-COUCH: PASS"
  exit 0
fi

bash scripts/verify-tv.sh --quiet
systemctl --user is-active mango-tv-pad.service &>/dev/null \
  || pgrep -f '[m]ango-tv-pad\.py' >/dev/null \
  || { echo "FAIL: pad not running" >&2; exit 1; }
echo "PRE-COUCH: PASS"
exit 0
