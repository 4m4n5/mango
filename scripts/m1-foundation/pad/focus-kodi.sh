#!/usr/bin/env bash
# Focus Kodi and present TV size.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=present-kodi.sh
source "$SCRIPT_DIR/present-kodi.sh"
# shellcheck source=lib/kodi-rpc.sh
source "$SCRIPT_DIR/lib/kodi-rpc.sh"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

WID=$(find_main_kodi_wid) || {
  echo "! Kodi window not found"
  exit 1
}

present_kodi_tv "$WID" || true
xdotool windowactivate "$WID" 2>/dev/null || true

# Only open YouTube when explicitly launching Kodi, not on incidental focus.
if [[ "${MANGO_KODI_OPEN_YOUTUBE:-}" == "1" ]] && ! kodi_youtube_ui_visible; then
  kodi_youtube_open || true
fi

NAME=$(xdotool getwindowname "$WID" 2>/dev/null || echo "?")
echo "✓ Kodi focused (wid=$WID name=$NAME)"

if kodi_is_tv_sized "$WID"; then
  echo "✓ Kodi TV-sized"
  exit 0
fi

echo "! Kodi not full screen yet"
exit 1
