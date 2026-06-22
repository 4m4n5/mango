#!/usr/bin/env bash
# Stop Phase 1 launcher server and Chromium windows (safe patterns for remote SSH).

set -euo pipefail

PID_DIR="${HOME}/.cache/mango"
PORT="${MANGO_LAUNCHER_PORT:-3000}"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if systemctl --user is-enabled mango-ui-server.service &>/dev/null; then
  systemctl --user stop mango-ui-server.service 2>/dev/null || true
fi
if systemctl --user is-enabled mango-launcher-chromium.service &>/dev/null 2>&1; then
  systemctl --user stop mango-launcher-chromium.service 2>/dev/null || true
fi

if [[ -f "$PID_DIR/mango-ui-server.pid" ]]; then
  pid=$(cat "$PID_DIR/mango-ui-server.pid")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_DIR/mango-ui-server.pid"
fi

pkill -f "chromium.*mango-launcher.*127.0.0.1:${PORT}/" 2>/dev/null || true
pkill -f "chromium.*mango-overlay.*127.0.0.1:${PORT}/overlay/" 2>/dev/null || true
sleep 0.5

echo "mango UI stopped"
