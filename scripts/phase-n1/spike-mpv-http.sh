#!/usr/bin/env bash
# S0 — mpv HTTP playback smoke (no Stremio). See phase-n1-catalog-play-spike.md §4 S0.

set -euo pipefail

URL="${MANGO_SPIKE_MP4_URL:-http://distribution.bbb3d.renderfarming.net/video/mp4/bbb_sunflower_1080p_30fps_normal.mp4}"
DURATION="${MANGO_SPIKE_SECONDS:-10}"
SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv-spike.sock}"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

mkdir -p "$(dirname "$SOCKET")"
rm -f "$SOCKET"

pkill -x mpv 2>/dev/null || true
sleep 0.3

echo "S0: mpv HTTP smoke — ${URL}"
START_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"

mpv --fs --no-terminal \
  --really-quiet \
  --hwdec=auto-safe \
  --input-ipc-server="$SOCKET" \
  --length="$DURATION" \
  "$URL" &
MPV_PID=$!

cleanup() {
  kill "$MPV_PID" 2>/dev/null || true
  wait "$MPV_PID" 2>/dev/null || true
  rm -f "$SOCKET"
}
trap cleanup EXIT

for _ in $(seq 1 50); do
  if [[ -S "$SOCKET" ]]; then
    break
  fi
  sleep 0.1
done

if [[ ! -S "$SOCKET" ]]; then
  echo "FAIL: mpv IPC socket not created" >&2
  exit 1
fi

# wait for playback-time > 0
for _ in $(seq 1 50); do
  PT="$(echo '{"command":["get_property","playback-time"]}' | socat - "$SOCKET" 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("data") or 0)' 2>/dev/null || echo 0)"
  if python3 -c "import sys; sys.exit(0 if float('${PT:-0}') > 0 else 1)" 2>/dev/null; then
    END_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
    echo "PASS: playback started (ttff_ms=$((END_MS - START_MS)))"
    exit 0
  fi
  sleep 0.2
done

echo "FAIL: playback did not start within 10s" >&2
exit 1
