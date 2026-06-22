#!/usr/bin/env bash
# Shared Stremio port cleanup helpers.

set -euo pipefail

STREMIO_PORTS=(11470 12470 11471 7000)

stremio_port_busy() {
  local port
  for port in "${STREMIO_PORTS[@]}"; do
    if ss -tln 2>/dev/null | grep -q ":${port} "; then
      return 0
    fi
  done
  return 1
}

stremio_process_running() {
  pgrep -x stremio >/dev/null 2>&1 \
    || pgrep -f '/opt/stremio' >/dev/null 2>&1 \
    || pgrep -f 'stremio-server' >/dev/null 2>&1 \
    || pgrep -f 'stremio/server' >/dev/null 2>&1 \
    || pgrep -f 'node.*stremio' >/dev/null 2>&1
}

stremio_ports_free() {
  local port attempt
  for attempt in $(seq 1 20); do
    if ! stremio_port_busy; then
      return 0
    fi
    for port in "${STREMIO_PORTS[@]}"; do
      if ss -tln 2>/dev/null | grep -q ":${port} "; then
        sudo fuser -k "${port}/tcp" 2>/dev/null || true
      fi
    done
    pkill -f 'stremio/server' 2>/dev/null || true
    pkill -f 'node.*stremio' 2>/dev/null || true
    sleep 0.25
  done
  return 1
}
