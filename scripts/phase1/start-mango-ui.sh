#!/usr/bin/env bash
# Start Phase 1 launcher server, Chromium kiosk, and overlay window.

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

# Phase 1 on Pi: overlay Chromium caused intermittent white-screen focus bugs.
# Phase 2 voice opts in explicitly after the orchestrator is running.
if [[ -z "${MANGO_SKIP_OVERLAY+x}" && "${MANGO_VOICE:-0}" == "1" ]]; then
  MANGO_SKIP_OVERLAY=0
elif [[ -z "${MANGO_SKIP_OVERLAY+x}" ]] && { [[ "$(uname -m)" == aarch64 ]] || [[ "$(uname -m)" == arm* ]]; }; then
  MANGO_SKIP_OVERLAY=1
fi
export MANGO_SKIP_OVERLAY="${MANGO_SKIP_OVERLAY:-0}"

cd "$REPO_DIR"
mkdir -p "$LOG_DIR" "$PID_DIR"

bash scripts/lib/mango-desktop.sh hide 2>/dev/null || true
bash scripts/lib/mango-cursor.sh hide 2>/dev/null || true
if [[ ! -f "${HOME}/.config/mango/tv-cursor.ok" ]]; then
  mkdir -p "${HOME}/.config/mango"
  bash scripts/phase0/install-tv-cursor.sh 2>/dev/null && touch "${HOME}/.config/mango/tv-cursor.ok" || true
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
  rm -rf src/launcher/dist src/overlay/dist
fi

build_ui_if_missing "src/launcher"
if [[ "${MANGO_SKIP_OVERLAY}" != "1" ]]; then
  build_ui_if_missing "src/overlay"
fi

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

if ! pgrep -f "chromium.*--class=mango-launcher.*127.0.0.1:${PORT}/" >/dev/null 2>&1; then
  "$CHROMIUM_BIN" \
    "${chromium_common_flags[@]}" \
    "${chromium_pi_flags[@]}" \
    --class=mango-launcher \
    --kiosk \
    --app="http://127.0.0.1:${PORT}/" \
    >"$LOG_DIR/mango-launcher-chromium.log" 2>&1 &
  sleep 0.25
fi

if [[ "${MANGO_SKIP_OVERLAY}" == "1" ]]; then
  pkill -f "chromium.*mango-overlay.*127.0.0.1:${PORT}/overlay/" 2>/dev/null || true
fi

if [[ "${MANGO_SKIP_OVERLAY}" != "1" ]] \
  && ! pgrep -f "mango-overlay.*127.0.0.1:${PORT}/overlay/" >/dev/null 2>&1; then
  OVERLAY_PROFILE="${HOME}/.cache/mango/chromium-overlay"
  mkdir -p "$OVERLAY_PROFILE"
  "$CHROMIUM_BIN" \
    "${chromium_common_flags[@]}" \
    "${chromium_pi_flags[@]}" \
    --user-data-dir="$OVERLAY_PROFILE" \
    --class=mango-overlay \
    --app="http://127.0.0.1:${PORT}/overlay/" \
    --window-size=700,240 \
    --window-position=560,812 \
    >"$LOG_DIR/mango-overlay-chromium.log" 2>&1 &
  sleep 0.5
fi

sleep 0.25
if command -v wmctrl >/dev/null 2>&1; then
  wmctrl -xa mango-launcher 2>/dev/null || wmctrl -xa chromium.Chromium 2>/dev/null || true
  if [[ "${MANGO_SKIP_OVERLAY}" != "1" ]]; then
    bash "$REPO_DIR/scripts/lib/present-overlay.sh" 2>/dev/null || true
  fi
  wmctrl -xa mango-launcher 2>/dev/null || wmctrl -xa chromium.Chromium 2>/dev/null || true
fi

bash scripts/lib/present-launcher.sh --quick 2>/dev/null || bash scripts/lib/present-launcher.sh 2>/dev/null || true

bash scripts/phase0/start-mango-tv-pad.sh 2>/dev/null || true

echo "mango UI running at http://127.0.0.1:${PORT}/"
