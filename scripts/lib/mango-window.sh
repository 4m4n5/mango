#!/usr/bin/env bash
# Hide or show the Phase 1 Chromium launcher + overlay on the TV.

set -u

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

hide_mango_shell() {
  command -v wmctrl >/dev/null 2>&1 || return 0
  wmctrl -x -r mango-launcher -b add,hidden 2>/dev/null || true
  wmctrl -r "mango launcher" -b add,hidden 2>/dev/null || true
  wmctrl -x -r mango-overlay -b add,hidden 2>/dev/null || true
  wmctrl -r "mango overlay" -b add,hidden 2>/dev/null || true
}

show_mango_shell() {
  command -v wmctrl >/dev/null 2>&1 || return 0
  wmctrl -x -r mango-overlay -b remove,hidden 2>/dev/null || true
  wmctrl -r "mango overlay" -b remove,hidden 2>/dev/null || true
  wmctrl -x -r mango-launcher -b remove,hidden 2>/dev/null || true
  wmctrl -r "mango launcher" -b remove,hidden 2>/dev/null || true
  wmctrl -xa mango-launcher 2>/dev/null || wmctrl -xa chromium.Chromium 2>/dev/null || true
}

case "${1:-}" in
  hide) hide_mango_shell ;;
  show) show_mango_shell ;;
  *)
    echo "usage: mango-window.sh hide|show" >&2
    exit 1
    ;;
esac
