#!/usr/bin/env bash
# Return focus to the Chromium launcher — hot path for ⌂ home.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=m1-foundation/pad/lib/irctl.sh
source "$REPO_DIR/scripts/m1-foundation/pad/lib/irctl.sh"
# shellcheck source=lib/launcher-window.sh
source "$REPO_DIR/scripts/lib/launcher-window.sh"

export DISPLAY=":0"
export XAUTHORITY="/home/aman/.Xauthority"
export HOME="/home/aman"
if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi
export MANGO_SKIP_OVERLAY=1
export MANGO_FAST_UI="${MANGO_FAST_UI:-1}"

# shellcheck source=lib/mango-log.sh
source "$REPO_DIR/scripts/lib/mango-log.sh"
if [[ -f "$REPO_DIR/scripts/diag/lib/diag-log.sh" ]]; then
  # shellcheck source=diag/lib/diag-log.sh
  source "$REPO_DIR/scripts/diag/lib/diag-log.sh"
fi

START_TS=$(date +%s%3N 2>/dev/null || date +%s)
mango_log launch_launcher status=start
if declare -F diag_log >/dev/null 2>&1; then
  diag_log launch_launcher status=start skip_pad="${MANGO_SKIP_PAD_STOP:-0}" skip_remapper="${MANGO_SKIP_REMAPPER:-0}"
fi

LOCK_DIR="${HOME}/.cache/mango"
LOCK_FILE="${LOCK_DIR}/launch-launcher.lock"
mkdir -p "$LOCK_DIR"

# Stop orphaned media focus loops (they steal focus back after ⌂).
pkill -f 'bash.*focus-kodi.sh' 2>/dev/null || true
pkill -f 'bash.*focus-stremio.sh' 2>/dev/null || true

# Drop duplicate home while a switch is in flight.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  mango_log launch_launcher status=busy
  echo "launch-launcher busy" >&2
  exit 1
fi

launcher_already_focused() {
  command -v xdotool >/dev/null 2>&1 || return 1
  active_window_is_launcher
}

if launcher_already_focused; then
  bash "$REPO_DIR/scripts/lib/present-launcher.sh" --quick 2>/dev/null || true
  flock -u 9
  exec 9>&-
  END_TS=$(date +%s%3N 2>/dev/null || date +%s)
  DURATION_MS=$((END_TS - START_TS))
  mango_log launch_launcher status=ok mode=noop "duration_ms=$DURATION_MS"
  if declare -F diag_log >/dev/null 2>&1; then
    diag_log launch_launcher status=ok mode=noop "duration_ms=$DURATION_MS"
  fi
  echo "Launcher already focused (${DURATION_MS}ms)"
  exit 0
fi

if command -v wmctrl >/dev/null 2>&1; then
  bash "$REPO_DIR/scripts/lib/hide-media.sh" all 2>/dev/null || true
  wmctrl -x -r mango-launcher -b remove,hidden 2>/dev/null || true
  wmctrl -r "mango launcher" -b remove,hidden 2>/dev/null || true
  wid="$(find_launcher_wid 2>/dev/null || true)"
  if [[ -n "$wid" ]] && command -v xdotool >/dev/null 2>&1; then
    xdotool windowactivate "$wid" 2>/dev/null || true
  fi
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

# Release flock before any subprocess — never let reader-service inherit fd 9.
flock -u 9
exec 9>&-

# One pad owner: ensure router after home (no sync input-remapper handoff).
if [[ "${MANGO_SKIP_REMAPPER:-}" != "1" ]]; then
  bash "$REPO_DIR/scripts/m1-foundation/pad/start-mango-tv-pad.sh" 2>/dev/null || \
    ir_resume_after_bridge "Pro Controller" "mango-tv"
fi

END_TS=$(date +%s%3N 2>/dev/null || date +%s)
DURATION_MS=$((END_TS - START_TS))
mango_log launch_launcher status=ok "duration_ms=$DURATION_MS"
if declare -F diag_log >/dev/null 2>&1; then
  diag_log launch_launcher status=ok "duration_ms=$DURATION_MS"
fi
echo "Launcher focus requested (${DURATION_MS}ms)"
