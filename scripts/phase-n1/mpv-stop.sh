#!/usr/bin/env bash
# Stop mpv and optionally return to launcher. See FOREGROUND.md mpv row.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
GO_HOME="${MANGO_MPV_STOP_HOME:-0}"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -S "$SOCKET" ]]; then
  echo '{"command":["quit"]}' | socat - "$SOCKET" 2>/dev/null || true
  sleep 0.5
fi

pkill -x mpv 2>/dev/null || true
rm -f "${HOME}/.cache/mango/mpv.pid" "$SOCKET"

if [[ "${GO_HOME}" == "1" ]]; then
  bash "${REPO_DIR}/scripts/launch-launcher.sh" \
    >/dev/null 2>&1 &
fi

exit 0
