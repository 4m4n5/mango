#!/usr/bin/env bash
# Launcher browser kiosk — used by start-mango-ui.sh and systemd.

set -euo pipefail

PORT="${MANGO_LAUNCHER_PORT:-3000}"
LOG_DIR="${HOME}/.cache/mango"
FIREFOX_PROFILE="${MANGO_LAUNCHER_FIREFOX_PROFILE:-${LOG_DIR}/firefox-launcher-profile}"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

mkdir -p "$LOG_DIR"

if [[ -x /usr/lib/chromium/chromium ]]; then
  # Debian's wrapper can inject stale V8 flags on aarch64 page-size checks.
  CHROMIUM_BIN="/usr/lib/chromium/chromium"
elif command -v chromium >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium"
elif command -v chromium-browser >/dev/null 2>&1; then
  CHROMIUM_BIN="chromium-browser"
else
  CHROMIUM_BIN=""
fi

if command -v firefox >/dev/null 2>&1; then
  FIREFOX_BIN="$(command -v firefox)"
elif command -v firefox-esr >/dev/null 2>&1; then
  FIREFOX_BIN="$(command -v firefox-esr)"
else
  FIREFOX_BIN=""
fi

chromium_known_bad_for_http() {
  [[ -n "$CHROMIUM_BIN" ]] || return 1
  [[ "$(uname -m)" == aarch64 ]] || return 1
  [[ "$(getconf PAGESIZE 2>/dev/null || echo 4096)" -gt 4096 ]] || return 1

  local version
  version="$("$CHROMIUM_BIN" --version 2>/dev/null || true)"
  [[ "$version" == Chromium\ 149.* ]]
}

choose_launcher_browser() {
  case "${MANGO_LAUNCHER_BROWSER:-auto}" in
    chromium)
      [[ -n "$CHROMIUM_BIN" ]] || {
        echo "chromium is required for MANGO_LAUNCHER_BROWSER=chromium" >&2
        exit 1
      }
      echo chromium
      ;;
    firefox)
      [[ -n "$FIREFOX_BIN" ]] || {
        echo "firefox is required for MANGO_LAUNCHER_BROWSER=firefox" >&2
        exit 1
      }
      echo firefox
      ;;
    auto | "")
      if chromium_known_bad_for_http && [[ -n "$FIREFOX_BIN" ]]; then
        echo firefox
      elif [[ -n "$CHROMIUM_BIN" ]]; then
        echo chromium
      elif [[ -n "$FIREFOX_BIN" ]]; then
        echo firefox
      else
        echo "chromium or firefox is required for the TV launcher" >&2
        exit 1
      fi
      ;;
    *)
      echo "unknown MANGO_LAUNCHER_BROWSER=${MANGO_LAUNCHER_BROWSER}" >&2
      exit 2
      ;;
  esac
}

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

write_firefox_profile() {
  mkdir -p "$FIREFOX_PROFILE"
  {
    printf '%s\n' 'user_pref("browser.shell.checkDefaultBrowser", false);'
    printf '%s\n' 'user_pref("browser.sessionstore.resume_from_crash", false);'
    printf '%s\n' 'user_pref("browser.startup.page", 0);'
    printf '%s\n' 'user_pref("browser.tabs.warnOnClose", false);'
    printf '%s\n' 'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);'
  } >"${FIREFOX_PROFILE}/user.js"
}

browser="$(choose_launcher_browser)"
echo "launcher browser: ${browser}" >>"$LOG_DIR/mango-launcher-chromium.log"

if [[ "$browser" == "firefox" ]]; then
  write_firefox_profile
  export MOZ_ENABLE_WAYLAND=0
  exec "$FIREFOX_BIN" \
    --no-remote \
    --profile "$FIREFOX_PROFILE" \
    --kiosk \
    "http://127.0.0.1:${PORT}/" \
    >>"$LOG_DIR/mango-launcher-chromium.log" 2>&1
else
  exec "$CHROMIUM_BIN" \
    "${chromium_common_flags[@]}" \
    "${chromium_pi_flags[@]}" \
    --class=mango-launcher \
    --kiosk \
    --app="http://127.0.0.1:${PORT}/" \
    >>"$LOG_DIR/mango-launcher-chromium.log" 2>&1
fi
