#!/usr/bin/env bash
# Open the YouTube addon UI inside Kodi (not the Kodi home screen).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/kodi-rpc.sh
source "$SCRIPT_DIR/lib/kodi-rpc.sh"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

wait_for_kodi_rpc

echo "Opening YouTube in Kodi..."
if ! kodi_youtube_open; then
  echo "! YouTube addon did not open — is plugin.video.youtube installed?" >&2
  exit 1
fi

bash "$SCRIPT_DIR/present-kodi.sh" >/dev/null 2>&1 || true
bash "$SCRIPT_DIR/../lib/mango-cursor.sh" hide 2>/dev/null || true

echo "✓ YouTube opened in Kodi"
exit 0
