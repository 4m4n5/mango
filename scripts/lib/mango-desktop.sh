#!/usr/bin/env bash
# Hide Pi desktop chrome (lxpanel) for TV — show again only for desktop debugging.

set -u

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

hide_lxpanel() {
  if command -v lxpanelctl >/dev/null 2>&1; then
    lxpanelctl hide 2>/dev/null || true
  fi
  if command -v xdotool >/dev/null 2>&1; then
    local wid
    for wid in $(xdotool search --classname lxpanel-pi 2>/dev/null); do
      xdotool windowunmap "$wid" 2>/dev/null || true
    done
  fi
  if command -v wmctrl >/dev/null 2>&1; then
    wmctrl -x -r lxpanel-pi.Lxpanel-pi -b add,hidden 2>/dev/null || true
    wmctrl -r "panel" -b add,hidden 2>/dev/null || true
  fi
  # lxpanel respawns child windows; stop the daemon for clean TV fullscreen.
  pkill -x lxpanel 2>/dev/null || true
}

show_lxpanel() {
  if ! pgrep -x lxpanel >/dev/null 2>&1; then
    if command -v lxpanel >/dev/null 2>&1; then
      lxpanel --profile LXDE-pi >/dev/null 2>&1 &
    elif command -v lxpanelctl >/dev/null 2>&1; then
      lxpanelctl show 2>/dev/null || true
    fi
  fi
}

case "${1:-hide}" in
  hide) hide_lxpanel ;;
  show) show_lxpanel ;;
  *)
    echo "usage: mango-desktop.sh hide|show" >&2
    exit 1
    ;;
esac
