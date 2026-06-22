#!/usr/bin/env bash
# Launch Kodi with remapper and open YouTube (warm start when Kodi is already up).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/irctl.sh
source "$SCRIPT_DIR/lib/irctl.sh"
# shellcheck source=lib/kodi-rpc.sh
source "$SCRIPT_DIR/lib/kodi-rpc.sh"

bash "$SCRIPT_DIR/connect-gamepad.sh"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export MANGO_SKIP_JS_RESTORE=1

# Keep Stremio alive in background — killing it breaks relaunch after YouTube.
bash "$SCRIPT_DIR/../lib/hide-media.sh" stremio 2>/dev/null || true

# Keep pad grabbed — stopping then restarting often hits EBUSY and falls back to
# input-remapper (⌂ = Control+Alt+m, which Kodi swallows).
if ! bash "$SCRIPT_DIR/start-mango-tv-pad.sh"; then
  echo "! mango TV pad failed — retry once" >&2
  sleep 0.5
  bash "$SCRIPT_DIR/start-mango-tv-pad.sh" || {
    echo "! Pad unavailable; ⌂ home will not work in Kodi" >&2
    bash "$SCRIPT_DIR/map-pro-controller.sh"
  }
fi
bash "$SCRIPT_DIR/kodi-keyboard-only.sh" 2>/dev/null || true

bash "$SCRIPT_DIR/../lib/mango-desktop.sh" hide 2>/dev/null || true
bash "$SCRIPT_DIR/../lib/mango-cursor.sh" hide 2>/dev/null || true

if kodi_process_running; then
  if wait_for_kodi_rpc; then
    echo "Kodi running — opening YouTube"
    bash "$SCRIPT_DIR/open-kodi-youtube.sh"
    bash "$SCRIPT_DIR/focus-kodi.sh" || true
    exit 0
  fi
  echo "Kodi running but RPC not ready — restarting Kodi"
  killall kodi kodi.bin 2>/dev/null || true
  sleep 0.3
fi

echo "Starting Kodi — D-pad = move, B = select, Y = back, ⌂ = home"
kodi &

bash "$SCRIPT_DIR/open-kodi-youtube.sh"
bash "$SCRIPT_DIR/focus-kodi.sh" || true
