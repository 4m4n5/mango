#!/usr/bin/env bash
# Stop all Stremio / streaming-server / DualSubtitles processes and free ports.
# Run on the Pi: bash scripts/m1-foundation/pad/kill-stremio.sh

set -euo pipefail

PORTS=(11470 12470 11471 7000)

# shellcheck source=lib/stremio-ports.sh
source "$(cd "$(dirname "$0")" && pwd)/lib/stremio-ports.sh"

if ! stremio_process_running && ! stremio_port_busy; then
  echo "✓ Stremio not running (nothing to kill)"
  exit 0
fi

echo "=== mango: kill Stremio ==="

killall stremio 2>/dev/null || true
pkill -f '/opt/stremio' 2>/dev/null || true
pkill -f 'stremio-server' 2>/dev/null || true
pkill -f 'DualSubtitles' 2>/dev/null || true
pkill -f 'stremio/server' 2>/dev/null || true
pkill -f 'node.*stremio' 2>/dev/null || true
pkill -f 'stremio-pad-bridge.py' 2>/dev/null || true
sudo pkill -f 'stremio-pad-bridge.py' 2>/dev/null || true
sudo rm -f /tmp/mango-stremio-pad-bridge.pid 2>/dev/null || true
rm -f "${HOME}/.cache/mango/stremio-pad-bridge.pid" 2>/dev/null || true

sleep 0.5

for port in "${PORTS[@]}"; do
  if ss -tln 2>/dev/null | grep -q ":${port} "; then
    echo "Port ${port} still in use — killing holder..."
    sudo fuser -k "${port}/tcp" 2>/dev/null || true
  fi
done

stremio_ports_free || true

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
