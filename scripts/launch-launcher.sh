#!/usr/bin/env bash
# Return focus to the Chromium launcher — hot path for ⌂ home.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=phase0/lib/irctl.sh
source "$REPO_DIR/scripts/phase0/lib/irctl.sh"

export DISPLAY=":0"
export XAUTHORITY="/home/aman/.Xauthority"
export HOME="/home/aman"
export MANGO_SKIP_OVERLAY="${MANGO_SKIP_OVERLAY:-1}"
export MANGO_FAST_UI="${MANGO_FAST_UI:-1}"

# shellcheck source=lib/mango-log.sh
source "$REPO_DIR/scripts/lib/mango-log.sh"

START_TS=$(date +%s%3N 2>/dev/null || date +%s)
mango_log launch_launcher status=start

LOCK_DIR="${HOME}/.cache/mango"
LOCK_FILE="${LOCK_DIR}/launch-launcher.lock"
mkdir -p "$LOCK_DIR"

# Drop duplicate home while a switch is in flight.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  mango_log launch_launcher status=busy
  echo "launch-launcher busy" >&2
  exit 1
fi

need_remapper=false
if pgrep -f stremio-pad-bridge.py >/dev/null 2>&1; then
  need_remapper=true
fi
if ! systemctl is-active --quiet input-remapper 2>/dev/null; then
  need_remapper=true
fi

export MANGO_SKIP_JS_RESTORE=1
bash "$REPO_DIR/scripts/phase0/stop-stremio-pad-bridge.sh" 2>/dev/null || true

if command -v wmctrl >/dev/null 2>&1; then
  wmctrl -r Stremio -b add,hidden 2>/dev/null || true
  wmctrl -r Kodi -b add,hidden 2>/dev/null || true
  wmctrl -x -r mango-launcher -b remove,hidden 2>/dev/null || true
  wmctrl -r "mango launcher" -b remove,hidden 2>/dev/null || true
  wmctrl -xa mango-launcher 2>/dev/null || true
fi

if [[ "${MANGO_FAST_UI}" != "1" ]]; then
  bash "$REPO_DIR/scripts/lib/mango-desktop.sh" hide 2>/dev/null || true
  bash "$REPO_DIR/scripts/lib/mango-window.sh" show
else
  if pgrep -x lxpanel >/dev/null 2>&1; then
    bash "$REPO_DIR/scripts/lib/mango-desktop.sh" hide 2>/dev/null || true
  fi
  bash "$REPO_DIR/scripts/lib/present-launcher.sh" --quick 2>/dev/null || \
    bash "$REPO_DIR/scripts/lib/present-launcher.sh" 2>/dev/null || true
fi

bash "$REPO_DIR/scripts/lib/mango-cursor.sh" hide 2>/dev/null || true

# Release flock before remapper resume — never let reader-service inherit fd 9.
flock -u 9
exec 9>&-

if $need_remapper; then
  ir_resume_after_bridge "Pro Controller" "mango-tv"
fi

END_TS=$(date +%s%3N 2>/dev/null || date +%s)
DURATION_MS=$((END_TS - START_TS))
mango_log launch_launcher status=ok "duration_ms=$DURATION_MS"
echo "Launcher focus requested (${DURATION_MS}ms)"
