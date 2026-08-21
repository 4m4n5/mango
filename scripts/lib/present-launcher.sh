#!/usr/bin/env bash
# Size the mango launcher browser window for TV (kiosk breaks after hide/show).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
source "$SCRIPT_DIR/launcher-window.sh"
# shellcheck source=mango-browse-display.sh
source "$SCRIPT_DIR/mango-browse-display.sh"

hide_desktop_chrome
ensure_browse_display_when_idle

launcher_is_tv_sized() {
  local wid=$1 screen_w screen_h
  command -v xdotool >/dev/null 2>&1 || return 1
  read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")
  eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)" || return 1
  # Reject Chromium's post-hide clamp (~1x1 / 200x200) even if displaygeom is wrong.
  (( WIDTH >= 800 && HEIGHT >= 600 )) || return 1
  (( WIDTH >= screen_w - 80 && HEIGHT >= screen_h - 80 ))
}

# Chromium can retain sibling mango-launcher top-level windows. Exactly one
# canonical InputOutput surface may be mapped; siblings stay alive but unmapped.
unmap_launcher_siblings() {
  local canonical=$1 wid
  command -v xdotool >/dev/null 2>&1 || return 0
  for wid in $(xdotool search --class mango-launcher 2>/dev/null); do
    launcher_window_is_input_output "$wid" || continue
    [[ "$wid" == "$canonical" ]] && continue
    if command -v wmctrl >/dev/null 2>&1; then
      wmctrl -i -r "$wid" -b add,below,hidden 2>/dev/null || true
    fi
    xdotool windowunmap "$wid" 2>/dev/null || true
  done
}

single_launcher_surface_ready() {
  local canonical=$1
  launcher_window_is_viewable "$canonical" \
    && launcher_is_tv_sized "$canonical" \
    && [[ "$(launcher_viewable_input_output_count)" == "1" ]]
}

present_launcher_tv() {
  local wid=$1 screen_w screen_h

  command -v xdotool >/dev/null 2>&1 || return 1

  read -r screen_w screen_h < <(xdotool getdisplaygeometry 2>/dev/null || echo "1920 1080")

  unmap_launcher_siblings "$wid"
  xdotool windowmap "$wid" 2>/dev/null || true
  xdotool windowactivate "$wid" 2>/dev/null || true
  xdotool windowmove "$wid" 0 0 2>/dev/null || true
  xdotool windowsize "$wid" "$screen_w" "$screen_h" 2>/dev/null || true

  if command -v wmctrl >/dev/null 2>&1; then
    wmctrl -i -r "$wid" -e "0,0,0,${screen_w},${screen_h}" 2>/dev/null || true
    wmctrl -i -r "$wid" -b add,maximized_vert,maximized_horz,fullscreen 2>/dev/null || true
    wmctrl -i -r "$wid" -b remove,hidden 2>/dev/null || true
  fi

  unmap_launcher_siblings "$wid"
  single_launcher_surface_ready "$wid" && return 0

  local attempt
  for attempt in 1 2 3; do
    unmap_launcher_siblings "$wid"
    xdotool windowsize "$wid" "$screen_w" "$screen_h" 2>/dev/null || true
    single_launcher_surface_ready "$wid" && return 0
    sleep 0.08
  done
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  QUICK=false
  [[ "${1:-}" == "--quick" ]] && QUICK=true

  WID=$(find_launcher_wid 2>/dev/null || find_launcher_wid_any 2>/dev/null) || {
    echo "! mango launcher window not found" >&2
    exit 1
  }

  if $QUICK && single_launcher_surface_ready "$WID"; then
    xdotool windowactivate "$WID" 2>/dev/null || true
    wmctrl -i -r "$WID" -b add,activated 2>/dev/null || true
    bash "$SCRIPT_DIR/mango-cursor.sh" hide 2>/dev/null || true
    echo "✓ Launcher focused (already TV-sized)"
    exit 0
  fi

  bash "$SCRIPT_DIR/mango-desktop.sh" hide 2>/dev/null || true

  if present_launcher_tv "$WID"; then
    eval "$(xdotool getwindowgeometry --shell "$WID" 2>/dev/null)" || true
    bash "$SCRIPT_DIR/mango-cursor.sh" hide 2>/dev/null || true
    echo "✓ Launcher TV-sized (wid=$WID ${WIDTH:-?}x${HEIGHT:-?})"
  else
    echo "! Launcher single-surface repair incomplete (wid=$WID); restart mango-launcher-chromium.service" >&2
    exit 1
  fi
fi
