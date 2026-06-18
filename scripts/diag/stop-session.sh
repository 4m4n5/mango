#!/usr/bin/env bash
# End diag session — stop poller, final snapshot, package tarball.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE="${HOME}/.cache/mango/diag"
# shellcheck source=lib/diag-log.sh
source "$SCRIPT_DIR/lib/diag-log.sh"

DIR="$(diag_session_dir)" || {
  echo "No active diag session" >&2
  exit 1
}

if [[ -f "${CACHE}/poll.pid" ]]; then
  kill "$(cat "${CACHE}/poll.pid")" 2>/dev/null || true
  rm -f "${CACHE}/poll.pid"
fi

bash "$SCRIPT_DIR/snapshot.sh" session-end
bash "$SCRIPT_DIR/collect-logs.sh"
diag_log session_end

cp -f "${HOME}/.cache/mango/mango.log" "${DIR}/mango.log.copy" 2>/dev/null || true
cp -f /tmp/mango-tv-pad.log "${DIR}/mango-tv-pad.log.copy" 2>/dev/null || true

TARBALL="${DIR}/session.tar.gz"
tar -czf "$TARBALL" -C "$(dirname "$DIR")" "$(basename "$DIR")" 2>/dev/null || true

echo ""
echo "Session stopped."
echo "  dir:     $DIR"
echo "  tarball: $TARBALL"
echo ""
echo "Paste to agent on Mac:"
echo "  bash scripts/diag/fetch-session.sh"
