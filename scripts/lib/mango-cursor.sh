#!/usr/bin/env bash
# Hide the mouse cursor on the TV (X11).

set -u

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

hide_cursor() {
  command -v xsetroot >/dev/null 2>&1 && xsetroot -cursor_name none 2>/dev/null || true
  if pgrep -f 'unclutter-xfixes -idle 0 -root' >/dev/null 2>&1 \
    || pgrep -f 'unclutter -idle 0 -root' >/dev/null 2>&1; then
    return 0
  fi
  if command -v unclutter-xfixes >/dev/null 2>&1; then
    pkill -f unclutter-xfixes 2>/dev/null || true
    unclutter-xfixes -idle 0 -root -noevents >/dev/null 2>&1 &
  elif command -v unclutter >/dev/null 2>&1; then
    pkill -x unclutter 2>/dev/null || true
    unclutter -idle 0 -root >/dev/null 2>&1 &
  fi
  if command -v xset >/dev/null 2>&1; then
    xset -dpms 2>/dev/null || true
    xset s off 2>/dev/null || true
    xset s noblank 2>/dev/null || true
    xset s 0 0 2>/dev/null || true
  fi
}

show_cursor() {
  pkill -f unclutter-xfixes 2>/dev/null || true
  pkill -x unclutter 2>/dev/null || true
}

case "${1:-hide}" in
  hide) hide_cursor ;;
  show) show_cursor ;;
  *)
    echo "usage: mango-cursor.sh hide|show" >&2
    exit 1
    ;;
esac
