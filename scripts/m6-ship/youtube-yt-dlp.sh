#!/usr/bin/env bash
# Wrapper used by catalog-service for native YouTube playback resolution.
# Deployment should run ensure-youtube-yt-dlp.sh first; playback itself must
# not block on network package installation.
#
# Preference: optional atomic slot, then the Mango venv, then (only when
# explicitly allowed) a local/system binary. A stale distro yt-dlp is not
# treated as release-ready.

set -euo pipefail

SLOT_ROOT="${MANGO_YTDLP_SLOT_ROOT:-$HOME/.local/share/mango/ytdlp-slots}"
SLOT_BIN="$SLOT_ROOT/active/venv/bin/yt-dlp"
VENV="${MANGO_YTDLP_VENV:-$HOME/.local/share/mango/ytdlp-venv}"
BIN="$VENV/bin/yt-dlp"
DENO_BIN="${MANGO_DENO:-$HOME/.local/share/mango/deno/bin/deno}"

if [[ -x "$DENO_BIN" ]]; then
  export PATH="$(dirname "$DENO_BIN"):$PATH"
fi

if [[ -x "$SLOT_BIN" ]]; then
  exec "$SLOT_BIN" "$@"
fi

if [[ -x "$BIN" ]]; then
  exec "$BIN" "$@"
fi

if [[ "${MANGO_YTDLP_ALLOW_SYSTEM:-0}" == "1" ]]; then
  if [[ -x "$HOME/.local/bin/yt-dlp" ]]; then
    exec "$HOME/.local/bin/yt-dlp" "$@"
  fi
  exec yt-dlp "$@"
fi

echo "youtube yt-dlp: no mango resolver (venv or slot) and system fallback is disabled" >&2
exit 1
