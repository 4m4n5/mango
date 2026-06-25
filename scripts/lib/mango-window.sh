#!/usr/bin/env bash
# Hide or show the Phase 1 Chromium launcher (+ optional overlay).

set -u

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export MANGO_SKIP_OVERLAY="${MANGO_SKIP_OVERLAY:-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=launcher-window.sh
source "$SCRIPT_DIR/launcher-window.sh"

_overlay_wid() {
  [[ "${MANGO_SKIP_OVERLAY}" == "1" ]] && return 0
  wmctrl -lx 2>/dev/null | awk '/mango-overlay/ {print $1; exit}'
}

present_mango_launcher() {
  bash "$SCRIPT_DIR/present-launcher.sh" 2>/dev/null || true
}

hide_mango_shell() {
  command -v wmctrl >/dev/null 2>&1 || return 0
  local wid owid
  owid=$(_overlay_wid)

  # Chromium kiosk ignores unmap/minimize; drop launcher below media apps.
  if command -v xdotool >/dev/null 2>&1; then
    local wid
    for wid in $(xdotool search --class mango-launcher 2>/dev/null); do
      wmctrl -i -r "$wid" -b add,below,hidden 2>/dev/null || true
      xdotool windowunmap "$wid" 2>/dev/null || true
      wmctrl -i -r "$wid" -e 0,-2000,-2000,1,1 2>/dev/null || true
    done
  fi
  if [[ -f "$SCRIPT_DIR/present-launcher.sh" ]]; then
    # shellcheck source=present-launcher.sh
    source "$SCRIPT_DIR/present-launcher.sh"
    wid=$(find_launcher_wid 2>/dev/null || true)
    if [[ -n "$wid" ]] && command -v xdotool >/dev/null 2>&1; then
      xdotool windowunmap "$wid" 2>/dev/null || true
      wmctrl -i -r "$wid" -e 0,-2000,-2000,1,1 2>/dev/null || true
    fi
  fi

  wmctrl -x -r mango-launcher -b add,hidden 2>/dev/null || true
  wmctrl -r "mango launcher" -b add,hidden 2>/dev/null || true

  if [[ "${MANGO_SKIP_OVERLAY}" != "1" ]]; then
    wmctrl -x -r mango-overlay -b remove,above,sticky 2>/dev/null || true
    wmctrl -r "mango overlay" -b remove,above,sticky 2>/dev/null || true
    wmctrl -x -r mango-overlay -b add,hidden 2>/dev/null || true
    wmctrl -r "mango overlay" -b add,hidden 2>/dev/null || true
    if [[ -n "$owid" ]]; then
      wmctrl -i -r "$owid" -e 0,-2000,-2000,1,1 2>/dev/null || true
    fi
  fi
}

show_mango_shell() {
  command -v wmctrl >/dev/null 2>&1 || return 0
  local script_dir wid

  script_dir="$SCRIPT_DIR"

  wmctrl -x -r mango-launcher -b remove,hidden 2>/dev/null || true
  wmctrl -r "mango launcher" -b remove,hidden 2>/dev/null || true

  if command -v xdotool >/dev/null 2>&1; then
    for wid in $(xdotool search --class mango-launcher 2>/dev/null); do
      xdotool windowmap "$wid" 2>/dev/null || true
      wmctrl -i -r "$wid" -b remove,below,hidden 2>/dev/null || true
    done
  fi

  bash "$script_dir/present-launcher.sh" --quick 2>/dev/null \
    || bash "$script_dir/present-launcher.sh" 2>/dev/null \
    || present_mango_launcher
  wid="$(find_launcher_wid 2>/dev/null || true)"
  if [[ -n "$wid" ]] && command -v xdotool >/dev/null 2>&1; then
    xdotool windowactivate "$wid" 2>/dev/null || true
  fi

  if [[ "${MANGO_SKIP_OVERLAY}" != "1" ]]; then
    local owid
    owid=$(_overlay_wid)
    wmctrl -x -r mango-overlay -b remove,hidden 2>/dev/null || true
    wmctrl -r "mango overlay" -b remove,hidden 2>/dev/null || true
    if [[ -n "$owid" ]]; then
      bash "$script_dir/present-overlay.sh" 2>/dev/null || \
        wmctrl -i -r "$owid" -e 0,900,560,360,120 2>/dev/null || true
    fi
  fi
}

case "${1:-}" in
  hide) hide_mango_shell ;;
  show) show_mango_shell ;;
  *)
    echo "usage: mango-window.sh hide|show" >&2
    exit 1
    ;;
esac
