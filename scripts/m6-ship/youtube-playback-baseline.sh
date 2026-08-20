#!/usr/bin/env bash
# Read-only YouTube playback baseline. Inventory plus optional resolver-only
# probes. Never starts mpv, never restarts services, never takes the TV.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
CORPUS="$REPO_ROOT/scripts/m6-ship/youtube-acceptance-corpus.json"
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

python3 - "$CORPUS" "$YTDLP" <<'PY'
import json, subprocess, sys, time
corpus = json.load(open(sys.argv[1], encoding="utf-8"))
ytdlp = sys.argv[2]
clients = ["web_safari", "tv_simply"]
for item in corpus.get("items", []):
    video_id = item["video_id"]
    kind = item["id"]
    for client in clients:
        started = time.time()
        try:
            proc = subprocess.run(
                [ytdlp, "--no-playlist", "--no-warnings", "--skip-download",
                 "--extractor-args", f"youtube:player_client={client}",
                 "--print", "%(live_status)s", "--print", "%(protocol)s",
                 f"https://www.youtube.com/watch?v={video_id}"],
                capture_output=True, text=True, timeout=20, check=False,
            )
            elapsed = int((time.time() - started) * 1000)
            ok = proc.returncode == 0
            lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
            live = lines[0] if lines else "unknown"
            protocol = lines[1] if len(lines) > 1 else "unknown"
            print(f"youtube-baseline: probe kind={kind} client={client} ok={ok} ms={elapsed} live={live} protocol={protocol}")
        except Exception as error:
            elapsed = int((time.time() - started) * 1000)
            print(f"youtube-baseline: probe kind={kind} client={client} ok=False ms={elapsed} error={type(error).__name__}")
PY
