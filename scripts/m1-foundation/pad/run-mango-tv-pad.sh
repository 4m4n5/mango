#!/usr/bin/env bash
# Run mango-tv-pad as root for evdev grab — fixed paths (no sudo -E).
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-/home/aman/.Xauthority}"
export HOME="/home/aman"
export USER="aman"
export SUDO_USER="aman"

if [[ -f "${HOME}/.cache/mango/diag/session.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${HOME}/.cache/mango/diag/session.env"
  set +a
fi

exec /usr/bin/python3 "${HOME}/mango/scripts/m1-foundation/pad/mango-tv-pad.py"
