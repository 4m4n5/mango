#!/usr/bin/env bash
# Wrapper used by catalog-service for native YouTube playback resolution.
# Deployment should run ensure-youtube-yt-dlp.sh first; playback itself must
# not block on network package installation.

set -euo pipefail

VENV="${MANGO_YTDLP_VENV:-$HOME/.local/share/mango/ytdlp-venv}"
BIN="$VENV/bin/yt-dlp"
DENO_BIN="${MANGO_DENO:-$HOME/.local/share/mango/deno/bin/deno}"

if [[ -x "$DENO_BIN" ]]; then
  export PATH="$(dirname "$DENO_BIN"):$PATH"
fi

if [[ -x "$BIN" ]]; then
  exec "$BIN" "$@"
fi

if [[ -x "$HOME/.local/bin/yt-dlp" ]]; then
  exec "$HOME/.local/bin/yt-dlp" "$@"
fi

exec yt-dlp "$@"
