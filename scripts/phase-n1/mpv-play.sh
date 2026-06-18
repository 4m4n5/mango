#!/usr/bin/env bash
# Start or replace mpv fullscreen. See phase-n1-catalog-play-spike.md §6.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

usage() {
  echo "usage: $0 --url <http-url> | --stop" >&2
  exit 2
}

URL=""
STOP=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --stop) STOP=true; shift ;;
    *) usage ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if $STOP; then
  exec bash "$SCRIPT_DIR/mpv-stop.sh"
fi

[[ -n "$URL" ]] || usage

mkdir -p "$(dirname "$SOCKET")"
bash "$SCRIPT_DIR/mpv-stop.sh" 2>/dev/null || true

URL_LABEL="$(python3 -c 'from urllib.parse import urlparse; import sys; u=urlparse(sys.argv[1]); print(f"{u.scheme}://{u.netloc}/<redacted>")' "$URL" 2>/dev/null || echo "http(s)://<redacted>")"
echo "mpv-play: $URL_LABEL"
START_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"

mpv --fs --idle=no --keep-open=no \
  --hwdec=auto-safe \
  --input-ipc-server="$SOCKET" \
  "$URL" &
echo $! >"${HOME}/.cache/mango/mpv.pid"

for _ in $(seq 1 75); do
  if [[ -S "$SOCKET" ]]; then
    REPLY="$(bash "$SCRIPT_DIR/mpv-ipc.sh" get_property playback-time 2>/dev/null || true)"
    PT="$(printf '%s' "$REPLY" | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("data") or 0)' 2>/dev/null || echo 0)"
    if python3 -c "import sys; sys.exit(0 if float('${PT:-0}') > 0 else 1)" 2>/dev/null; then
      END_MS="$(python3 -c 'import time; print(int(time.time()*1000))')"
      echo "PASS: ttff_ms=$((END_MS - START_MS))"
      exit 0
    fi
  fi
  sleep 0.2
done

echo "FAIL: mpv did not start playback within 15s" >&2
exit 1
