#!/usr/bin/env bash
# Start the mango launcher server and single browser kiosk.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
PORT="${MANGO_LAUNCHER_PORT:-3000}"
LOG_DIR="${HOME}/.cache/mango"
PID_DIR="${HOME}/.cache/mango"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

# N0: launcher-embedded voice HUD is the only TV HUD. The second Chromium
# overlay remains out of the default runtime even when voice is enabled.
export MANGO_SKIP_OVERLAY=1

cd "$REPO_DIR"
# shellcheck source=../../lib/launcher-window.sh
source "$REPO_DIR/scripts/lib/launcher-window.sh"
mkdir -p "$LOG_DIR" "$PID_DIR"

bash scripts/lib/mango-desktop.sh hide 2>/dev/null || true
bash scripts/lib/mango-cursor.sh hide 2>/dev/null || true
bash scripts/lib/mango-display-mode.sh launcher 2>/dev/null || true
if [[ ! -f "${HOME}/.config/mango/tv-cursor.ok" ]]; then
  mkdir -p "${HOME}/.config/mango"
  bash scripts/m1-foundation/pad/install-tv-cursor.sh 2>/dev/null && touch "${HOME}/.config/mango/tv-cursor.ok" || true
fi

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
  rm -rf src/launcher/dist
fi

build_ui_if_missing "src/launcher"

start_ui_server() {
  if systemctl --user is-enabled mango-ui-server.service &>/dev/null; then
    systemctl --user start mango-ui-server.service
    return
  fi
  if [[ -f "$PID_DIR/mango-ui-server.pid" ]] && kill -0 "$(cat "$PID_DIR/mango-ui-server.pid")" 2>/dev/null; then
    echo "mango UI server already running"
    return
  fi
  python3 src/mango-ui-server/serve.py --host 127.0.0.1 --port "$PORT" \
    >"$LOG_DIR/mango-ui-server.log" 2>&1 &
  echo "$!" >"$PID_DIR/mango-ui-server.pid"
}

start_ui_server

for _ in $(seq 1 15); do
  curl -sf --max-time 0.5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break
  sleep 0.1
done

launcher_browser_pattern() {
  printf '%s' "chromium.*--class=mango-launcher.*127.0.0.1:${PORT}/|firefox.*127.0.0.1:${PORT}/"
}

start_launcher_browser_kiosk() {
  if systemctl --user is-enabled mango-launcher-chromium.service &>/dev/null 2>&1; then
    systemctl --user start mango-launcher-chromium.service
    return
  fi
  if ! pgrep -f "$(launcher_browser_pattern)" >/dev/null 2>&1; then
    if command -v systemd-run >/dev/null 2>&1; then
      systemd-run --user --scope \
        -p "MemoryMax=512M" \
        -p "OOMScoreAdjust=800" \
        --unit=mango-launcher-chromium-scope \
        bash "$REPO_DIR/scripts/m1-foundation/ui/start-mango-launcher-chromium.sh" \
        >/dev/null 2>&1 &
    else
      bash "$REPO_DIR/scripts/m1-foundation/ui/start-mango-launcher-chromium.sh" &
    fi
    sleep 0.25
  fi
}

start_launcher_browser_kiosk

pkill -f "chromium.*mango-overlay.*127.0.0.1:${PORT}/overlay/" 2>/dev/null || true

sleep 0.25
if command -v xdotool >/dev/null 2>&1; then
  wid="$(find_launcher_wid 2>/dev/null || true)"
  if [[ -n "$wid" ]]; then
    xdotool windowactivate "$wid" 2>/dev/null || true
    xdotool windowactivate "$wid" 2>/dev/null || true
  fi
fi

bash scripts/lib/present-launcher.sh --quick 2>/dev/null || bash scripts/lib/present-launcher.sh 2>/dev/null || true

bash scripts/m1-foundation/pad/start-mango-tv-pad.sh 2>/dev/null || true

echo "mango UI running at http://127.0.0.1:${PORT}/"
