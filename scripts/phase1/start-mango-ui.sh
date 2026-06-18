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

if [[ "${MANGO_REBUILD_UI:-}" == "1" ]]; then
  rm -rf src/launcher/dist src/overlay/dist
fi

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

chromium_common_flags=(
  --no-first-run
  --no-default-browser-check
  --disable-infobars
  --disable-translate
  --noerrdialogs
)

chromium_pi_flags=()
if [[ "$(uname -m)" == aarch64 ]] || [[ "$(uname -m)" == arm* ]]; then
  chromium_pi_flags+=(--disable-gpu --disable-gpu-compositing)
fi

if ! pgrep -f "mango-launcher.*http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
  "$CHROMIUM_BIN" \
    "${chromium_common_flags[@]}" \
    "${chromium_pi_flags[@]}" \
    --class=mango-launcher \
    --kiosk \
    --app="http://127.0.0.1:${PORT}/" \
    >"$LOG_DIR/mango-launcher-chromium.log" 2>&1 &
fi

if [[ "${MANGO_SKIP_OVERLAY:-}" != "1" ]] \
  && ! pgrep -f "mango-overlay.*http://127.0.0.1:${PORT}/overlay/" >/dev/null 2>&1; then
  "$CHROMIUM_BIN" \
    "${chromium_common_flags[@]}" \
    "${chromium_pi_flags[@]}" \
    --class=mango-overlay \
    --app="http://127.0.0.1:${PORT}/overlay/" \
    --window-size=360,120 \
    --window-position=900,560 \
    >"$LOG_DIR/mango-overlay-chromium.log" 2>&1 &
fi

sleep 2
if command -v wmctrl >/dev/null 2>&1; then
  wmctrl -xa mango-launcher 2>/dev/null || wmctrl -xa chromium.Chromium 2>/dev/null || true
  if [[ "${MANGO_SKIP_OVERLAY:-}" != "1" ]]; then
    wmctrl -x -r mango-overlay -e 0,900,560,360,120 2>/dev/null \
      || wmctrl -r "mango overlay" -e 0,900,560,360,120 2>/dev/null \
      || true
    wmctrl -x -r mango-overlay -b add,sticky,above 2>/dev/null \
      || wmctrl -r "mango overlay" -b add,sticky,above 2>/dev/null \
      || true
  fi
  wmctrl -xa mango-launcher 2>/dev/null || wmctrl -xa chromium.Chromium 2>/dev/null || true
fi

bash scripts/launch-launcher.sh

echo "mango UI running at http://127.0.0.1:${PORT}/"
