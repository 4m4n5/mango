#!/usr/bin/env bash
# Size the mango launcher Chromium window for TV (kiosk breaks after hide/show).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

find_launcher_pid() {
  pgrep -f 'chromium.*--class=mango-launcher.*127\.0\.0\.1:3000/' 2>/dev/null | head -1
}

find_launcher_wid() {
  local pid wid
  pid=$(find_launcher_pid) || true
  if [[ -n "$pid" ]] && command -v xdotool >/dev/null 2>&1; then
    wid=$(xdotool search --pid "$pid" 2>/dev/null | head -1)
    [[ -n "$wid" ]] && echo "$wid" && return 0
  fi
  if command -v wmctrl >/dev/null 2>&1; then
    wid=$(wmctrl -lx 2>/dev/null | awk '/\.mango-launcher/ && !/overlay/ {print $1; exit}')
    [[ -n "$wid" ]] && echo "$wid" && return 0
  fi
  return 1
}

launcher_is_tv_sized() {
  local wid=$1 screen_w screen_h
  command -v xdotool >/dev/null 2>&1 || return 1
  read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")
  eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || return 1
  (( WIDTH >= screen_w - 80 && HEIGHT >= screen_h - 80 ))
}

present_launcher_tv() {
  local wid=$1 screen_w screen_h

  command -v xdotool >/dev/null 2>&1 || return 1

  read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")

  xdotool windowactivate "$wid" 2>/dev/null || true
  xdotool windowmove "$wid" 0 0 2>/dev/null || true
  xdotool windowsize "$wid" "$screen_w" "$screen_h" 2>/dev/null || true

  if command -v wmctrl >/dev/null 2>&1; then
    wmctrl -i -r "$wid" -e "0,0,0,${screen_w},${screen_h}" 2>/dev/null || true
    wmctrl -i -r "$wid" -b add,maximized_vert,maximized_horz,fullscreen 2>/dev/null || true
    wmctrl -i -r "$wid" -b remove,hidden 2>/dev/null || true
  fi

  launcher_is_tv_sized "$wid" && return 0

  local attempt
  for attempt in 1 2 3; do
    xdotool windowsize "$wid" "$screen_w" "$screen_h" 2>/dev/null || true
    launcher_is_tv_sized "$wid" && return 0
    sleep 0.08
  done
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  QUICK=false
  [[ "${1:-}" == "--quick" ]] && QUICK=true

  WID=$(find_launcher_wid) || {
    echo "! mango launcher window not found" >&2
    exit 1
  }

  if $QUICK && launcher_is_tv_sized "$WID"; then
    xdotool windowactivate "$WID" 2>/dev/null || true
    wmctrl -i -r "$WID" -b add,activated 2>/dev/null || true
    echo "✓ Launcher focused (already TV-sized)"
    exit 0
  fi

  bash "$SCRIPT_DIR/mango-desktop.sh" hide 2>/dev/null || true

  if present_launcher_tv "$WID"; then
    eval "$(xdotool getwindowgeometry --shell "$WID" 2>/dev/null)" || true
    echo "✓ Launcher TV-sized (wid=$WID ${WIDTH:-?}x${HEIGHT:-?})"
  else
    echo "! Launcher resize incomplete (wid=$WID)" >&2
    exit 1
  fi
fi
