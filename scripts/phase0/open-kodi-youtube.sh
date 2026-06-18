#!/usr/bin/env bash
# Open the YouTube addon UI inside Kodi (not the Kodi home screen).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/kodi-rpc.sh
source "$SCRIPT_DIR/lib/kodi-rpc.sh"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

wait_for_kodi_rpc

echo "Opening YouTube addon in Kodi..."
RESP=$(kodi_rpc Addons.ExecuteAddon '{"addonid":"plugin.video.youtube"}')
echo "$RESP"

if echo "$RESP" | grep -qi '"error"'; then
  echo "! YouTube addon failed to open — is plugin.video.youtube installed?" >&2
  exit 1
fi

sleep 2

if command -v wmctrl >/dev/null 2>&1; then
  wmctrl -r Kodi -b add,maximized_vert,maximized_horz,fullscreen 2>/dev/null || true
fi

if command -v xdotool &>/dev/null; then
  WID=$(xdotool search --name Kodi 2>/dev/null | head -1 || true)
  if [[ -n "$WID" ]]; then
    read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")
    xdotool windowactivate --sync "$WID" 2>/dev/null || true
    xdotool windowmove --sync "$WID" 0 0 2>/dev/null || true
    xdotool windowsize --sync "$WID" "$screen_w" "$screen_h" 2>/dev/null || true
    xdotool key --window "$WID" alt+F10 2>/dev/null || true
  fi
fi

echo "✓ YouTube addon opened"
