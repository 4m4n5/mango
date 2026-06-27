#!/usr/bin/env bash
# Install/update Mango's isolated yt-dlp resolver for native YouTube playback.
#
# Debian's packaged yt-dlp can lag behind YouTube extractor changes. Keep the
# volatile resolver in a user-owned venv so repo deploys stay git-only and
# system packages stay untouched.

set -euo pipefail

VENV="${MANGO_YTDLP_VENV:-$HOME/.local/share/mango/ytdlp-venv}"
BIN="$VENV/bin/yt-dlp"
STAMP="$VENV/.mango-last-update"
INTERVAL_SEC="${MANGO_YTDLP_UPDATE_INTERVAL_SEC:-86400}"

mkdir -p "$(dirname "$VENV")"

now_epoch() {
  python3 - <<'PY'
import time
print(int(time.time()))
PY
}

stamp_epoch() {
  if [[ -f "$STAMP" ]]; then
    python3 - "$STAMP" <<'PY'
import os
import sys
try:
    print(int(os.path.getmtime(sys.argv[1])))
except OSError:
    print(0)
PY
  else
    echo 0
  fi
}

needs_update=0
if [[ ! -x "$BIN" ]]; then
  needs_update=1
elif [[ "${MANGO_YTDLP_UPDATE:-auto}" == "1" ]]; then
  needs_update=1
elif [[ "${MANGO_YTDLP_UPDATE:-auto}" != "0" ]]; then
  age=$(( $(now_epoch) - $(stamp_epoch) ))
  if [[ "$age" -ge "$INTERVAL_SEC" ]]; then
    needs_update=1
  fi
fi

if [[ "$needs_update" == "1" ]]; then
  python3 -m venv "$VENV"
  if "$VENV/bin/python" -m pip install --quiet --upgrade pip yt-dlp; then
    date +%s >"$STAMP"
  elif [[ -x "$BIN" ]]; then
    echo "youtube yt-dlp: update failed; keeping existing $("$BIN" --version)" >&2
  elif command -v yt-dlp >/dev/null 2>&1; then
    echo "youtube yt-dlp: venv install failed; falling back to system $(yt-dlp --version)" >&2
    exit 0
  else
    echo "youtube yt-dlp: install failed and no fallback yt-dlp exists" >&2
    exit 1
  fi
fi

if [[ -x "$BIN" ]]; then
  echo "youtube yt-dlp: $("$BIN" --version) ($BIN)"
elif command -v yt-dlp >/dev/null 2>&1; then
  echo "youtube yt-dlp: system $(yt-dlp --version) ($(command -v yt-dlp))"
fi
