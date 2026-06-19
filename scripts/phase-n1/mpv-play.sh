#!/usr/bin/env bash
# Start or replace mpv fullscreen. See phase-n1-catalog-play-spike.md §6.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
MPV_LOG="${MANGO_MPV_LOG:-${HOME}/.cache/mango/mpv-play.log}"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

usage() {
  echo "usage: $0 --url <http-url> [--probe] [--timeout-ms 4000] [--min-duration-sec 600] | --stop" >&2
  exit 2
}

URL=""
STOP=false
PROBE=false
TIMEOUT_MS=15000
MIN_DURATION_SEC=600
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --stop) STOP=true; shift ;;
    --probe) PROBE=true; shift ;;
    --timeout-ms) TIMEOUT_MS="${2:-}"; shift 2 ;;
    --min-duration-sec) MIN_DURATION_SEC="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if $STOP; then
  exec bash "$SCRIPT_DIR/mpv-stop.sh"
fi

[[ -n "$URL" ]] || usage
[[ "$TIMEOUT_MS" =~ ^[0-9]+$ ]] || usage
[[ "$MIN_DURATION_SEC" =~ ^[0-9]+$ ]] || usage

now_ms() {
  python3 -c 'import time; print(int(time.time()*1000))'
}

mpv_property() {
  local property="$1"
  local reply
  reply="$(bash "$SCRIPT_DIR/mpv-ipc.sh" get_property "$property" 2>/dev/null || true)"
  python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("data") or 0)' <<<"$reply" 2>/dev/null || echo 0
}

playback_is_real() {
  local playback_time="$1"
  local duration
  local min_duration="$MIN_DURATION_SEC"
  if $PROBE; then
    min_duration=5
  fi
  duration="$(mpv_property duration)"
  python3 - "$playback_time" "$duration" "$min_duration" <<'PY'
import sys
playback = float(sys.argv[1] or 0)
duration = float(sys.argv[2] or 0)
min_duration = float(sys.argv[3] or 0)
if playback < 1.5:
    raise SystemExit(1)
if duration > 0 and duration < min_duration:
    raise SystemExit(2)
raise SystemExit(0)
PY
}

detect_hwdec() {
  if [[ -n "${MANGO_MPV_HWDEC:-}" ]]; then
    printf '%s\n' "$MANGO_MPV_HWDEC"
    return
  fi
  if grep -qi 'raspberry pi' /proc/device-tree/model 2>/dev/null; then
    printf '%s\n' "v4l2m2m-copy"
    return
  fi
  printf '%s\n' "auto-safe"
}

mkdir -p "$(dirname "$SOCKET")"
mkdir -p "$(dirname "$MPV_LOG")"
bash "$SCRIPT_DIR/mpv-stop.sh" 2>/dev/null || true

URL_LABEL="$(python3 -c 'from urllib.parse import urlparse; import sys; u=urlparse(sys.argv[1]); print(f"{u.scheme}://{u.netloc}/<redacted>")' "$URL" 2>/dev/null || echo "http(s)://<redacted>")"
HWDEC="$(detect_hwdec)"
MODE="play"
if $PROBE; then
  MODE="probe"
fi
echo "mpv-play: $URL_LABEL mode=$MODE timeout_ms=$TIMEOUT_MS min_duration_sec=$MIN_DURATION_SEC hwdec=$HWDEC"
START_MS="$(now_ms)"
DEADLINE_MS=$((START_MS + TIMEOUT_MS))

mpv --fs --idle=no --keep-open=no --no-terminal \
  --hwdec="$HWDEC" \
  --input-ipc-server="$SOCKET" \
  "$URL" >>"$MPV_LOG" 2>&1 &
MPV_PID=$!
echo "$MPV_PID" >"${HOME}/.cache/mango/mpv.pid"

while [[ "$(now_ms)" -lt "$DEADLINE_MS" ]]; do
  if [[ -S "$SOCKET" ]]; then
    REPLY="$(bash "$SCRIPT_DIR/mpv-ipc.sh" get_property playback-time 2>/dev/null || true)"
    PT="$(printf '%s' "$REPLY" | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("data") or 0)' 2>/dev/null || echo 0)"
    if python3 -c "import sys; sys.exit(0 if float('${PT:-0}') > 0 else 1)" 2>/dev/null; then
      if playback_is_real "${PT:-0}"; then
        END_MS="$(now_ms)"
        echo "PASS: ttff_ms=$((END_MS - START_MS))"
        if $PROBE; then
          bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
        fi
        exit 0
      fi
      DUR="$(mpv_property duration)"
      local min_duration="$MIN_DURATION_SEC"
      if $PROBE; then
        min_duration=5
      fi
      if python3 -c "import sys; d=float('${DUR:-0}'); sys.exit(0 if d > 0 and d < float('${min_duration}') else 1)" 2>/dev/null; then
        echo "FAIL: debrid_status_clip duration=${DUR}" >&2
        bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
        exit 1
      fi
    fi
  fi
  if ! kill -0 "$MPV_PID" 2>/dev/null; then
    if tail -40 "$MPV_LOG" 2>/dev/null | grep -qiE 'copyright infringement|removed from.*debrid|file was removed'; then
      echo "FAIL: debrid_copyright_block" >&2
      bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
      exit 1
    fi
    break
  fi
  sleep 0.2
done

if tail -40 "$MPV_LOG" 2>/dev/null | grep -qiE 'copyright infringement|removed from.*debrid|file was removed'; then
  echo "FAIL: debrid_copyright_block" >&2
  bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
  exit 1
fi

echo "FAIL: mpv did not start playback within ${TIMEOUT_MS}ms" >&2
bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
exit 1
