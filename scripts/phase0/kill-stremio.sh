#!/usr/bin/env bash
# Stop all Stremio / streaming-server / DualSubtitles processes and free ports.
# Run on the Pi: bash scripts/phase0/kill-stremio.sh

set -euo pipefail

PORTS=(11470 12470 11471 7000)

echo "=== mango: kill Stremio ==="

killall stremio 2>/dev/null || true
pkill -f '/opt/stremio' 2>/dev/null || true
pkill -f 'stremio-server' 2>/dev/null || true
pkill -f 'DualSubtitles' 2>/dev/null || true
pkill -f 'stremio/server' 2>/dev/null || true
pkill -f 'node.*stremio' 2>/dev/null || true
pkill -f 'stremio-pad-bridge.py' 2>/dev/null || true
rm -f /tmp/mango-stremio-pad-bridge.pid

sleep 2

for port in "${PORTS[@]}"; do
  if ss -tln 2>/dev/null | grep -q ":${port} "; then
    echo "Port ${port} still in use — killing holder..."
    sudo fuser -k "${port}/tcp" 2>/dev/null || true
  fi
done

sleep 1

list_stremio_procs() {
  pgrep -af '/opt/stremio|DualSubtitles' 2>/dev/null || true
  local pid
  for pid in $(pgrep -x stremio 2>/dev/null || true); do
    ps -p "$pid" -o args= 2>/dev/null || true
  done
}

echo
echo "Remaining stremio/node (should be empty):"
REMAINING=$(list_stremio_procs | sed '/^$/d' || true)
if [[ -z "$REMAINING" ]]; then
  echo "  (none)"
else
  echo "$REMAINING"
fi

echo
echo "Ports:"
ports_busy=false
for port in "${PORTS[@]}"; do
  if ss -tln 2>/dev/null | grep -q ":${port} "; then
    echo "  ! ${port} STILL IN USE"
    ports_busy=true
  else
    echo "  ✓ ${port} free"
  fi
done

if [[ -n "$REMAINING" ]] || $ports_busy; then
  echo
  echo "! Stremio still running or ports busy — try: sudo reboot"
  exit 1
fi

echo
echo "✓ Stremio fully stopped"
