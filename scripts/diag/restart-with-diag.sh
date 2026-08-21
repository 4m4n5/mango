#!/usr/bin/env bash
# Restart mango UI with a fresh diagnostic session (run on the Pi).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export HOME="${HOME:-/home/aman}"

cd "$REPO_DIR"

# shellcheck source=m1-foundation/pad/lib/irctl.sh
source "$REPO_DIR/scripts/m1-foundation/pad/lib/irctl.sh"

bash "$SCRIPT_DIR/stop-session.sh" 2>/dev/null || true
rm -f "${HOME}/.cache/mango/launch-launcher.lock"
ir_kill_readers || true

bash "$SCRIPT_DIR/start-session.sh"

# Load diag env for pad
set -a
# shellcheck disable=SC1091
source "${HOME}/.cache/mango/diag/session.env"
set +a

echo "=== restarting mango UI ==="
bash "$REPO_DIR/scripts/m1-foundation/ui/restart-mango-ui.sh"

echo "=== starting TV pad (debug) ==="
bash "$REPO_DIR/scripts/m1-foundation/pad/stop-mango-tv-pad.sh" 2>/dev/null || true
sleep 0.3
bash "$REPO_DIR/scripts/m1-foundation/pad/start-mango-tv-pad.sh" || true

bash "$SCRIPT_DIR/snapshot.sh" post-restart
bash "$SCRIPT_DIR/check-prerequisites.sh" 2>/dev/null || true
bash "$REPO_DIR/scripts/verify-tv.sh" 2>/dev/null || true

SESSION_DIR="$(cat "${HOME}/.cache/mango/diag/current_session")"
echo ""
echo "Ready for couch test. Session: $SESSION_DIR"
echo ""
bash "$SCRIPT_DIR/print-runbook.sh"
