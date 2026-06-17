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

sleep 2

# Force-free ports if zombies remain (needs sudo on Pi OS)
for port in "${PORTS[@]}"; do
  if ss -tln 2>/dev/null | grep -q ":${port} "; then
    echo "Port ${port} still in use — killing holder..."
    sudo fuser -k "${port}/tcp" 2>/dev/null || true
  fi
done

sleep 1

echo
echo "Remaining stremio/node (should be empty):"
pgrep -af 'stremio|DualSubtitles|/opt/stremio' 2>/dev/null || echo "  (none)"

echo
echo "Ports:"
for port in "${PORTS[@]}"; do
  if ss -tln 2>/dev/null | grep -q ":${port} "; then
    echo "  ! ${port} STILL IN USE"
  else
    echo "  ✓ ${port} free"
  fi
done

if pgrep -af 'stremio|DualSubtitles|/opt/stremio' >/dev/null 2>&1; then
  echo
  echo "! Some processes remain — try: sudo reboot"
  exit 1
fi

echo
echo "✓ Stremio fully stopped"
