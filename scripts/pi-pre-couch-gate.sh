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

MAINT_LOCK="${XDG_CACHE_HOME:-$HOME/.cache}/mango/playability-maintenance.lock"
if [[ -f "$MAINT_LOCK" ]] || pgrep -f '[p]layability-indexer.ts' >/dev/null 2>&1; then
  echo "FAIL: playability maintenance/grow in progress — couch stack is down" >&2
  echo "  check: python3 scripts/diag/grow_monitor.py status" >&2
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
