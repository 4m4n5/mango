#!/usr/bin/env bash
# Hide the mouse cursor on the TV (X11).

set -u

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

hide_cursor() {
  if command -v unclutter-xfixes >/dev/null 2>&1; then
    pkill -f unclutter-xfixes 2>/dev/null || true
    unclutter-xfixes -idle 0 -root -noevents >/dev/null 2>&1 &
  elif command -v unclutter >/dev/null 2>&1; then
    pkill -x unclutter 2>/dev/null || true
    unclutter -idle 0 -root >/dev/null 2>&1 &
  fi
  command -v xset >/dev/null 2>&1 && xset -dpms 2>/dev/null || true
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
