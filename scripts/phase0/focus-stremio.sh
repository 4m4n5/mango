#!/usr/bin/env bash
# Focus the Stremio window (needed for input-remapper keyboard events).
# Run on the Pi: bash scripts/phase0/focus-stremio.sh

set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

try_focus() {
  local wid

  if command -v wmctrl &>/dev/null; then
    if wmctrl -l 2>/dev/null | grep -qi stremio; then
      wmctrl -a Stremio 2>/dev/null && return 0
      wid=$(wmctrl -l 2>/dev/null | grep -i stremio | head -1 | awk '{print $1}')
      if [[ -n "$wid" ]]; then
        wmctrl -i -a "$wid" 2>/dev/null && return 0
      fi
    fi
  fi

  if command -v xdotool &>/dev/null; then
    for pattern in stremio Stremio; do
      wid=$(xdotool search --name "$pattern" 2>/dev/null | head -1 || true)
      [[ -n "$wid" ]] && xdotool windowactivate --sync "$wid" 2>/dev/null && return 0
      wid=$(xdotool search --class "$pattern" 2>/dev/null | head -1 || true)
      [[ -n "$wid" ]] && xdotool windowactivate --sync "$wid" 2>/dev/null && return 0
    done
  fi

  return 1
}

if try_focus; then
  echo "✓ Stremio focused"
  exit 0
fi

echo "! Stremio window not found — is it running?"
echo "Open windows:"
wmctrl -l 2>/dev/null || echo "  (wmctrl failed — is DISPLAY=:0 set?)"
pgrep -x stremio >/dev/null 2>&1 && echo "  stremio process: running" || echo "  stremio process: not running"
exit 1
