#!/usr/bin/env bash
# Size the mango voice overlay to a small HUD (Chromium ignores --window-size on Pi).

set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

OVERLAY_X="${MANGO_OVERLAY_X:-900}"
OVERLAY_Y="${MANGO_OVERLAY_Y:-560}"
OVERLAY_W="${MANGO_OVERLAY_W:-360}"
OVERLAY_H="${MANGO_OVERLAY_H:-120}"

find_overlay_wid() {
  local wid
  if command -v wmctrl >/dev/null 2>&1; then
    wid=$(wmctrl -lx 2>/dev/null | awk '/\.mango-overlay/ {print $1; exit}')
    [[ -n "$wid" ]] && echo "$wid" && return 0
  fi
  if command -v xdotool >/dev/null 2>&1; then
    wid=$(xdotool search --class mango-overlay 2>/dev/null | head -1)
    [[ -n "$wid" ]] && echo "$wid" && return 0
  fi
  return 1
}

present_overlay_hud() {
  local wid=$1

  if command -v wmctrl >/dev/null 2>&1; then
    wmctrl -i -r "$wid" -b remove,maximized_vert,maximized_horz,fullscreen,hidden 2>/dev/null || true
    wmctrl -i -r "$wid" -e "0,${OVERLAY_X},${OVERLAY_Y},${OVERLAY_W},${OVERLAY_H}" 2>/dev/null || true
    wmctrl -i -r "$wid" -b add,sticky,above,skip_taskbar,skip_pager 2>/dev/null || true
  fi

  if command -v xdotool >/dev/null 2>&1; then
    xdotool windowmove "$wid" "$OVERLAY_X" "$OVERLAY_Y" 2>/dev/null || true
    xdotool windowsize "$wid" "$OVERLAY_W" "$OVERLAY_H" 2>/dev/null || true
  fi
}

refocus_launcher() {
  if command -v wmctrl >/dev/null 2>&1; then
    wmctrl -xa mango-launcher 2>/dev/null || true
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  WID=$(find_overlay_wid) || {
    echo "! mango overlay window not found" >&2
    exit 1
  }

  present_overlay_hud "$WID"
  refocus_launcher

  if command -v xdotool >/dev/null 2>&1; then
    eval "$(xdotool getwindowgeometry --shell "$WID" 2>/dev/null)" || true
    echo "✓ Overlay HUD (wid=$WID ${WIDTH:-?}x${HEIGHT:-?} @ ${OVERLAY_X},${OVERLAY_Y})"
  else
    echo "✓ Overlay HUD positioned"
  fi
fi
