#!/usr/bin/env bash
# Push Kodi / Stremio off-screen (wmctrl hidden alone is not enough on Pi).

set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

hide_window_class() {
  local class=$1
  command -v xdotool &>/dev/null || return 0
  local wid
  for wid in $(xdotool search --class "$class" 2>/dev/null); do
    wmctrl -i -r "$wid" -b add,hidden,below 2>/dev/null || true
    xdotool windowunmap "$wid" 2>/dev/null || true
    wmctrl -i -r "$wid" -e 0,-2000,-2000,1,1 2>/dev/null || true
  done
  wmctrl -r "$class" -b add,hidden 2>/dev/null || true
}

hide_kodi() {
  hide_window_class "Kodi"
}

hide_stremio() {
  hide_window_class "Stremio"
}

case "${1:-}" in
  kodi) hide_kodi ;;
  stremio) hide_stremio ;;
  all)
    hide_stremio
    hide_kodi
    ;;
  *)
    echo "usage: hide-media.sh kodi|stremio|all" >&2
    exit 1
    ;;
esac
