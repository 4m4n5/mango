#!/usr/bin/env bash
# Run a command on the mango Pi from the Mac (non-interactive SSH).
# Deploy is git-only: push from Mac, pull on Pi — never rsync. See docs/DEPLOY.md
# Usage: bash scripts/pi-exec.sh 'hostname -I'
#        bash scripts/pi-exec.sh -- 'bash ~/mango/scripts/m1-foundation/pad/verify-system.sh'

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${MANGO_SSH_HOST:-mango}"

if ! ssh -o BatchMode=yes -o ConnectTimeout=12 "$HOST" 'true' 2>/dev/null; then
  cat >&2 <<EOF
Cannot SSH to $HOST without a password.

One-time fix on your Mac:
  bash $REPO_ROOT/scripts/setup-mac-pi-ssh.sh

Then paste the printed authorize line in your Pi SSH session.
EOF
  exit 255
fi

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ $# -eq 0 ]]; then
  exec ssh -tt "$HOST"
fi

# Single string argument → remote bash -lc (preserves quoting)
if [[ $# -eq 1 ]]; then
  ssh "$HOST" "bash -lc $(printf '%q' "$1")"
else
  ssh "$HOST" "$@"
fi
