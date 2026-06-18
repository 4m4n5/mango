#!/usr/bin/env bash
# Mark a user action in the diag timeline.
# Usage: bash scripts/diag/mark.sh "opened kodi youtube"
#        bash scripts/diag/mark.sh step-4 home-press-1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/diag-log.sh
source "$SCRIPT_DIR/lib/diag-log.sh"

NOTE="${*:-}"
if [[ -z "$NOTE" ]]; then
  echo "usage: bash scripts/diag/mark.sh <what you just did>" >&2
  exit 2
fi

DIR="$(diag_session_dir)" || {
  echo "No active diag session" >&2
  exit 1
}

bash "$SCRIPT_DIR/snapshot.sh" "mark-${NOTE// /-}" >/dev/null
diag_log user_mark note="$NOTE"
echo "✓ marked: $NOTE"
echo "  session: $DIR"
