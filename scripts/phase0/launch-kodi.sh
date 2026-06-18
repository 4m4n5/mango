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

bash "$SCRIPT_DIR/stop-stremio-pad-bridge.sh" 2>/dev/null || true
killall stremio 2>/dev/null || true

if systemctl is-active --quiet input-remapper 2>/dev/null; then
  ir_resume_after_bridge "Pro Controller" "mango-tv"
else
  bash "$SCRIPT_DIR/map-pro-controller.sh"
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
