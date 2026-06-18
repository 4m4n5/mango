#!/usr/bin/env bash
# Stop mpv and optionally return to launcher. See FOREGROUND.md mpv row.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
GO_HOME="${MANGO_MPV_STOP_HOME:-0}"
HOME_LAUNCHED=0

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

launch_home_once() {
  if [[ "${GO_HOME}" == "1" && "$HOME_LAUNCHED" -eq 0 ]]; then
    HOME_LAUNCHED=1
    bash "${REPO_DIR}/scripts/launch-launcher.sh" \
      >/dev/null 2>&1 &
  fi
}

if [[ -S "$SOCKET" ]]; then
  echo '{"command":["quit"]}' | socat - "$SOCKET" >/dev/null 2>&1 || true
  launch_home_once
  sleep 0.2
fi

pkill -x mpv 2>/dev/null || true
rm -f "${HOME}/.cache/mango/mpv.pid" "$SOCKET"

launch_home_once

exit 0
