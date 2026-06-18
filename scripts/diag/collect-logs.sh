#!/usr/bin/env bash
# Copy all mango log files into the active diag session.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/diag-log.sh
source "$SCRIPT_DIR/lib/diag-log.sh"

DIR="$(diag_session_dir)" || {
  echo "No active diag session" >&2
  exit 1
}

LOGS="${DIR}/logs"
mkdir -p "$LOGS"
HOME="${HOME:-/home/aman}"

copy_if() {
  local src=$1
  local dest=$2
  [[ -f "$src" ]] || return 0
  cp -f "$src" "$LOGS/$dest" 2>/dev/null || true
}

copy_if "${HOME}/.cache/mango/mango.log" mango.log
copy_if "${HOME}/.cache/mango/mango-ui-server.log" mango-ui-server.log
copy_if "${HOME}/.cache/mango/mango-ui-launch.log" mango-ui-launch.log
copy_if "${HOME}/.cache/mango/mango-launcher-chromium.log" mango-launcher-chromium.log
copy_if "${HOME}/.cache/mango/mango-overlay-chromium.log" mango-overlay-chromium.log
copy_if /tmp/mango-tv-pad.log mango-tv-pad.log
copy_if /tmp/mango-stremio-pad-bridge.log stremio-pad-bridge.log
copy_if /tmp/mango-stremio.log stremio.log
copy_if "${HOME}/.kodi/temp/kodi.log" kodi.log

{
  echo "=== git ==="
  git -C "${HOME}/mango" rev-parse HEAD 2>/dev/null || echo "?"
  echo "=== wmctrl ==="
  DISPLAY="${DISPLAY:-:0}" XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}" wmctrl -lx 2>/dev/null || true
  echo "=== ss stremio ports ==="
  ss -tln 2>/dev/null | grep -E ':11470|:12470|:11471|:7000|:8080|:3000' || true
  echo "=== systemctl ==="
  systemctl is-active input-remapper 2>/dev/null || true
  systemctl --user is-active mango-ui-server.service 2>/dev/null || echo "mango-ui-server: not enabled"
} >"${LOGS}/system.txt" 2>/dev/null || true

diag_log collect_logs dir="$LOGS"
echo "logs → $LOGS"
