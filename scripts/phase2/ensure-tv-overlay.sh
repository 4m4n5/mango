#!/usr/bin/env bash
# Rebuild overlay UI and ensure the TV HUD Chromium window is up.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
PORT="${MANGO_LAUNCHER_PORT:-3000}"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

cd "$REPO_DIR"

if command -v npm >/dev/null 2>&1; then
  npm --prefix src/overlay run build
fi

# Always restart overlay Chromium so it loads fresh dist + WS URL.
pkill -f "chromium.*mango-overlay.*127.0.0.1:${PORT}/overlay/" 2>/dev/null || true
sleep 0.4

if ! curl -sf --max-time 0.5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  bash scripts/phase1/start-mango-ui.sh
  exit 0
fi

if command -v chromium >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium"
elif command -v chromium-browser >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium-browser"
else
  echo "chromium not found" >&2
  exit 1
fi

LOG_DIR="${HOME}/.cache/mango"
mkdir -p "$LOG_DIR"

OVERLAY_PROFILE="${HOME}/.cache/mango/chromium-overlay"
mkdir -p "$OVERLAY_PROFILE"
"$CHROMIUM_BIN" \
  --no-first-run \
  --no-default-browser-check \
  --disable-infobars \
  --disable-translate \
  --noerrdialogs \
  --disable-gpu \
  --disable-gpu-compositing \
  --user-data-dir="$OVERLAY_PROFILE" \
  --class=mango-overlay \
  --app="http://127.0.0.1:${PORT}/overlay/" \
  --window-size=700,240 \
    --window-position=560,812 \
  >"$LOG_DIR/mango-overlay-chromium.log" 2>&1 &
sleep 0.6

bash "$REPO_DIR/scripts/lib/present-overlay.sh" 2>/dev/null || true
wmctrl -xa mango-launcher 2>/dev/null || true
echo "✓ TV overlay HUD ready"
