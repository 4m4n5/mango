#!/usr/bin/env bash
# Read-only YouTube playback baseline. Inventory plus optional resolver-only
# probes. Never starts mpv, never restarts services, never takes the TV.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
YTDLP="$REPO_ROOT/scripts/m6-ship/youtube-yt-dlp.sh"
PROBES="${MANGO_YOUTUBE_BASELINE_PROBES:-1}"

echo "youtube-baseline: host=$(hostname) user=$(id -un)"
echo "youtube-baseline: git=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
echo "youtube-baseline: branch=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo unknown)"

echo "youtube-baseline: node=$(node --version 2>/dev/null || echo missing)"
echo "youtube-baseline: deno=$(deno --version 2>/dev/null | head -n1 || echo missing)"
echo "youtube-baseline: mpv=$(mpv --version 2>/dev/null | head -n1 || echo missing)"
echo "youtube-baseline: ffmpeg=$(ffmpeg -version 2>/dev/null | head -n1 || echo missing)"
echo "youtube-baseline: curl-enabled=$(mpv --curl-enabled=help >/dev/null 2>&1 && echo present || echo unknown)"
if [[ -f /etc/mango/youtube-cookies.txt ]]; then
  echo "youtube-baseline: cookies=present"
else
  echo "youtube-baseline: cookies=absent"
fi

if [[ -x "$YTDLP" ]]; then
  echo "youtube-baseline: yt-dlp=$("$YTDLP" --version 2>/dev/null || echo missing)"
fi

if curl -sf --max-time 3 "$CATALOG/health" >/dev/null 2>&1; then
  python3 - "$CATALOG" <<'PY'
import json, urllib.request, sys
url = sys.argv[1] + "/youtube/state"
with urllib.request.urlopen(url, timeout=5) as response:
    payload = json.load(response)
playback = payload.get("playback") or {}
configured = payload.get("configured") or {}
print("youtube-baseline: state.enabled=" + str(payload.get("enabled")))
print("youtube-baseline: command_kind=" + str(configured.get("yt_dlp_command_kind")))
for key in (
    "slot_revision", "slot_channel", "ejs_ready", "js_runtime",
    "pot_ready", "cookies_configured", "canary", "rollback_available", "fallback",
):
    if key in playback:
        print(f"youtube-baseline: {key}={playback[key]}")
PY
else
  echo "youtube-baseline: catalog=unreachable"
fi

if [[ "$PROBES" != "1" ]]; then
  exit 0
fi

python3 "$REPO_ROOT/scripts/m6-ship/youtube-runtime-canary.py" \
  --yt-dlp "$YTDLP" \
  --repo-root "$REPO_ROOT" \
  --deno "${MANGO_DENO:-$HOME/.local/share/mango/deno/bin/deno}" \
  --resolve-only
