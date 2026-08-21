#!/usr/bin/env bash
# Legacy udev hook retained for old installations. New installs remove the udev
# rule: BlueZ link service owns reconnection and this hook never connects BT.

set -euo pipefail

USER_NAME="${MANGO_TV_USER:-${USER:?set MANGO_TV_USER}}"
HOME_DIR="/home/${USER_NAME}"
REPO="${HOME_DIR}/mango"
LOCK="${HOME_DIR}/.cache/mango/pad-udev.lock"
LOG="${HOME_DIR}/.cache/mango/pad-udev.log"

mkdir -p "$(dirname "$LOCK")" "$(dirname "$LOG")"

exec 9>"$LOCK"
if ! flock -n 9; then
  exit 0
fi

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-${HOME_DIR}/.Xauthority}"
export HOME="$HOME_DIR"
export USER="$USER_NAME"

{
  echo "=== $(date -Is) on-pro-controller-connect ==="
  bash "${REPO}/scripts/m1-foundation/pad/controller-link-control.sh" --retry || true
  sleep 0.4
  bash "${REPO}/scripts/m1-foundation/pad/start-mango-tv-pad.sh" || true
} >>"$LOG" 2>&1
