#!/usr/bin/env bash
# Start Phase 1 launcher server, Chromium kiosk, and overlay window.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
PORT="${MANGO_LAUNCHER_PORT:-3000}"
LOG_DIR="${HOME}/.cache/mango"
PID_DIR="${HOME}/.cache/mango"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

cd "$REPO_DIR"
mkdir -p "$LOG_DIR" "$PID_DIR"

build_ui_if_missing() {
  local app_dir="$1"
  if [[ -d "$app_dir/dist" ]]; then
    return
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to build $app_dir. Install nodejs/npm or build on Mac first." >&2
    exit 1
  fi
  if [[ ! -d "$app_dir/node_modules" ]]; then
    npm --prefix "$app_dir" install
  fi
  npm --prefix "$app_dir" run build
}

build_ui_if_missing "src/launcher"
build_ui_if_missing "src/overlay"

if [[ -f "$PID_DIR/mango-ui-server.pid" ]] && kill -0 "$(cat "$PID_DIR/mango-ui-server.pid")" 2>/dev/null; then
  echo "mango UI server already running"
else
  python3 src/mango-ui-server/serve.py --host 127.0.0.1 --port "$PORT" \
    >"$LOG_DIR/mango-ui-server.log" 2>&1 &
  echo "$!" >"$PID_DIR/mango-ui-server.pid"
fi

sleep 1

if command -v chromium >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium"
elif command -v chromium-browser >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium-browser"
else
  echo "chromium is required for the TV launcher" >&2
  exit 1
fi

if ! pgrep -f "mango-launcher.*http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
  "$CHROMIUM_BIN" --class=mango-launcher --kiosk --app="http://127.0.0.1:${PORT}/" \
    >"$LOG_DIR/mango-launcher-chromium.log" 2>&1 &
fi

if ! pgrep -f "mango-overlay.*http://127.0.0.1:${PORT}/overlay/" >/dev/null 2>&1; then
  "$CHROMIUM_BIN" --class=mango-overlay --app="http://127.0.0.1:${PORT}/overlay/" \
    --window-size=360,120 --window-position=900,560 --always-on-top \
    >"$LOG_DIR/mango-overlay-chromium.log" 2>&1 &
fi

sleep 2
if command -v wmctrl >/dev/null 2>&1; then
  wmctrl -r "mango overlay" -b add,above,sticky 2>/dev/null || true
  wmctrl -xa mango-launcher 2>/dev/null || wmctrl -xa chromium.Chromium 2>/dev/null || true
fi

bash scripts/launch-launcher.sh

echo "mango UI running at http://127.0.0.1:${PORT}/"
