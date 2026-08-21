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
    # Pi OS wallpaper is pcmanfm --desktop (above X root). Unmap it so
    # black-screen-first is real black, not the desktop wallpaper.
    for wid in $(xdotool search --classname Pcmanfm 2>/dev/null); do
      xdotool windowunmap "$wid" 2>/dev/null || true
    done
    for wid in $(xdotool search --name 'Desktop' 2>/dev/null); do
      xdotool windowunmap "$wid" 2>/dev/null || true
    done
  fi
  if command -v wmctrl >/dev/null 2>&1; then
    wmctrl -x -r lxpanel-pi.Lxpanel-pi -b add,hidden 2>/dev/null || true
    wmctrl -r "panel" -b add,hidden 2>/dev/null || true
    wmctrl -x -r pcmanfm.Pcmanfm -b add,hidden 2>/dev/null || true
  fi
  # Prefer turning the desktop off over killing pcmanfm (file-manager may share the process).
  if command -v pcmanfm >/dev/null 2>&1; then
    pcmanfm --desktop-off >/dev/null 2>&1 || true
  fi
  # lxpanel respawns child windows; stop the daemon for clean TV fullscreen.
  pkill -x lxpanel 2>/dev/null || true
  # Paint the X root black so any exposure between fullscreen windows (mpv
  # unmap → xrandr → launcher paint) reveals only black — no wallpaper flash.
  # Idempotent, ~2 ms; kiosk keeps this black permanently.
  if command -v xsetroot >/dev/null 2>&1; then
    xsetroot -solid black 2>/dev/null || true
  fi
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
