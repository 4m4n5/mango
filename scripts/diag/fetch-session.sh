#!/usr/bin/env bash
# Pull latest diag session from Pi to Mac (run from repo root on Mac).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${MANGO_SSH_HOST:-mango}"
LOCAL_DIR="${REPO_ROOT}/.cache/mango-diag-from-pi"
mkdir -p "$LOCAL_DIR"

REMOTE_TAR=$(ssh -o BatchMode=yes "$HOST" 'bash -lc "
  d=$(cat ~/.cache/mango/diag/current_session 2>/dev/null || true)
  if [[ -z \"$d\" || ! -d \"$d\" ]]; then
    ls -td ~/.cache/mango/diag/sessions/*/ 2>/dev/null | head -1
  else
    echo \"$d\"
  fi
"')

REMOTE_TAR="${REMOTE_TAR%/}"
if [[ -z "$REMOTE_TAR" ]]; then
  echo "No diag session on Pi" >&2
  exit 1
fi

SESSION_ID="$(basename "$REMOTE_TAR")"
OUT="${LOCAL_DIR}/${SESSION_ID}"

ssh "$HOST" "tar -czf - -C \"$(dirname "$REMOTE_TAR")\" \"$(basename "$REMOTE_TAR")\"" | tar -xzf - -C "$LOCAL_DIR"

echo "Fetched → $OUT"
echo ""
echo "Key files:"
find "$OUT" -maxdepth 2 -type f | sort | head -20
echo ""
echo "Agent: read $OUT/events.jsonl and $OUT/poll.jsonl"
