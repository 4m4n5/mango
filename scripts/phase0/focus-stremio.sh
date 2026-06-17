#!/usr/bin/env bash
# Focus the Stremio window (needed for input-remapper keyboard events).
# Run on the Pi: bash scripts/phase0/focus-stremio.sh

set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

try_focus() {
  local wid

  if wmctrl -l 2>/dev/null | grep -qi stremio; then
    wmctrl -a Stremio 2>/dev/null && return 0
    wid=$(wmctrl -l 2>/dev/null | grep -i stremio | head -1 | awk '{print $1}')
    if [[ -n "$wid" ]]; then
      wmctrl -i -a "$wid" 2>/dev/null && return 0
    fi
  fi

  if command -v xdotool &>/dev/null; then
    wid=$(xdotool search --name -i stremio 2>/dev/null | head -1 || true)
    if [[ -n "$wid" ]]; then
      xdotool windowactivate --sync "$wid" 2>/dev/null && return 0
    fi
  fi

  return 1
}

if try_focus; then
  echo "✓ Stremio focused"
  exit 0
fi

echo "! Stremio window not found — is it running?"
wmctrl -l 2>/dev/null || true
exit 1
