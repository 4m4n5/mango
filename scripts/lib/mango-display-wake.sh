#!/usr/bin/env bash
# Wake/keep-on helper for Mango's X11 couch session.

set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

FOCUS_IDLE=0
if [[ "${1:-}" == "--focus-launcher-if-idle" ]]; then
  FOCUS_IDLE=1
fi

if command -v xset >/dev/null 2>&1; then
  xset -dpms 2>/dev/null || true
  xset s off 2>/dev/null || true
  xset s noblank 2>/dev/null || true
  xset s 0 0 2>/dev/null || true
  xset dpms force on 2>/dev/null || true
  xset s reset 2>/dev/null || true
fi

if [[ "$FOCUS_IDLE" == "1" ]] && ! pgrep -x mpv >/dev/null 2>&1; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  bash "$SCRIPT_DIR/present-launcher.sh" --quick >/dev/null 2>&1 \
    || bash "$SCRIPT_DIR/present-launcher.sh" >/dev/null 2>&1 \
    || true
fi
