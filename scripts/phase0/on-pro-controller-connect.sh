#!/usr/bin/env bash
# udev hook: Pro Controller input appeared — ensure BT + pad router.
# Installed by install-pad-autoreconnect.sh (do not run manually unless testing).

set -euo pipefail

USER_NAME="${MANGO_TV_USER:-aman}"
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
  bash "${REPO}/scripts/phase0/connect-gamepad.sh" || true
  sleep 0.4
  bash "${REPO}/scripts/phase0/start-mango-tv-pad.sh" || true
} >>"$LOG" 2>&1
