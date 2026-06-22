#!/usr/bin/env bash
# Chromium kiosk for mango launcher — used by start-mango-ui.sh and systemd.

set -euo pipefail

PORT="${MANGO_LAUNCHER_PORT:-3000}"
LOG_DIR="${HOME}/.cache/mango"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

mkdir -p "$LOG_DIR"

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

exec "$CHROMIUM_BIN" \
  "${chromium_common_flags[@]}" \
  "${chromium_pi_flags[@]}" \
  --class=mango-launcher \
  --kiosk \
  --app="http://127.0.0.1:${PORT}/" \
  >>"$LOG_DIR/mango-launcher-chromium.log" 2>&1
