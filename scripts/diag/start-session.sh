#!/usr/bin/env bash
# Start a TV diagnostic session (logging + polling).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE="${HOME}/.cache/mango/diag"
SESSION_ID="$(date +%Y%m%d-%H%M%S)"
SESSION_DIR="${CACHE}/sessions/${SESSION_ID}"

mkdir -p "$SESSION_DIR/snapshots"
printf '%s\n' "$SESSION_DIR" >"${CACHE}/current_session"

export MANGO_DIAG_SESSION="$SESSION_DIR"
export MANGO_PAD_DEBUG=1

cat >"${CACHE}/session.env" <<EOF
MANGO_DIAG_SESSION=${SESSION_DIR}
MANGO_PAD_DEBUG=1
EOF

# shellcheck source=lib/diag-log.sh
source "$SCRIPT_DIR/lib/diag-log.sh"
diag_log session_start session_id="$SESSION_ID" repo="$REPO_DIR"

# Stop any prior poll
if [[ -f "${CACHE}/poll.pid" ]]; then
  kill "$(cat "${CACHE}/poll.pid")" 2>/dev/null || true
  rm -f "${CACHE}/poll.pid"
fi

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

nohup bash "$SCRIPT_DIR/poll-state.sh" >>"${SESSION_DIR}/poll-stdout.log" 2>&1 &
echo $! >"${CACHE}/poll.pid"
diag_log poll_started pid="$(cat "${CACHE}/poll.pid")"

bash "$SCRIPT_DIR/snapshot.sh" baseline

cat <<EOF

═══════════════════════════════════════════════════════════
  mango TV diag session: ${SESSION_ID}
  logs: ${SESSION_DIR}
═══════════════════════════════════════════════════════════

Mark each step from the Pi SSH session (or Mac via pi-exec):
  bash ~/mango/scripts/diag/mark.sh "<what you did>"

When done on the couch:
  bash ~/mango/scripts/diag/stop-session.sh

EOF
