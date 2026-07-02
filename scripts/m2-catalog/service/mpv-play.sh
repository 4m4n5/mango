#!/usr/bin/env bash
# Start or replace mpv fullscreen. See phase-n1-catalog-play-spike.md §6.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
MPV_LOG="${MANGO_MPV_LOG:-${HOME}/.cache/mango/mpv-play.log}"
PLAY_CANCEL_FILE="${MANGO_PLAY_CANCEL_PATH:-${HOME}/.cache/mango/play-cancel.epoch}"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

usage() {
  echo "usage: $0 --url <http-url> [--audio-url <http-url>] [--probe] [--live] [--timeout-ms 4000] [--min-duration-sec 600] | --stop" >&2
  exit 2
}

URL=""
AUDIO_URL=""
STOP=false
PROBE=false
LIVE=false
TIMEOUT_MS=15000
MIN_DURATION_SEC=600
MIN_DURATION_SET=false
START_SEC=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --audio-url) AUDIO_URL="${2:-}"; shift 2 ;;
    --stop) STOP=true; shift ;;
    --probe) PROBE=true; shift ;;
    --live) LIVE=true; shift ;;
    --timeout-ms) TIMEOUT_MS="${2:-}"; shift 2 ;;
    --min-duration-sec) MIN_DURATION_SEC="${2:-}"; MIN_DURATION_SET=true; shift 2 ;;
    --start-sec) START_SEC="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
AUDIO_ENV="${HOME}/.config/mango/audio.env"
if [[ -f "$AUDIO_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$AUDIO_ENV"
fi

if $STOP; then
  exec bash "$SCRIPT_DIR/mpv-stop.sh"
fi

if [[ -x "$REPO_DIR/scripts/lib/couch-activity.sh" ]]; then
  bash "$REPO_DIR/scripts/lib/couch-activity.sh" touch mpv play >/dev/null 2>&1 || true
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
  if $LIVE; then
    python3 - "$playback_time" <<'PY'
import sys
playback = float(sys.argv[1] or 0)
raise SystemExit(0 if playback >= 1.0 else 1)
PY
    return $?
  fi
  if $PROBE && ! $MIN_DURATION_SET; then
    min_duration=5
  fi
  duration="$(mpv_property duration)"
  python3 - "$playback_time" "$duration" "$min_duration" <<'PY'
import sys
playback = float(sys.argv[1] or 0)
duration = float(sys.argv[2] or 0)
min_duration = float(sys.argv[3] or 0)
if duration > 0 and duration < min_duration:
    raise SystemExit(2)
if duration <= 0 and playback < 3.0:
    raise SystemExit(1)
if duration > 0 and playback < 1.5:
    raise SystemExit(1)
raise SystemExit(0)
PY
}

play_cancelled() {
  [[ -n "${MANGO_PLAY_EPOCH:-}" ]] || return 1
  [[ -f "$PLAY_CANCEL_FILE" ]] || return 1
  [[ "$(tr -d '[:space:]' <"$PLAY_CANCEL_FILE" 2>/dev/null || true)" != "$MANGO_PLAY_EPOCH" ]]
}

detect_hwdec() {
  if [[ -n "${MANGO_MPV_HWDEC:-}" ]]; then
    printf '%s\n' "$MANGO_MPV_HWDEC"
    return
  fi
  if grep -qi 'raspberry pi' /proc/device-tree/model 2>/dev/null; then
    printf '%s\n' "drm-copy"
    return
  fi
  printf '%s\n' "auto-safe"
}

detect_audio_args() {
  local configured_device="${MANGO_MPV_AUDIO_DEVICE:-}"
  local configured_ao="${MANGO_MPV_AO:-}"
  local saved_sink="${MANGO_AUDIO_SINK:-}"
  local default_sink=""

  if [[ -z "$configured_device" && "$saved_sink" == alsa/* ]]; then
    configured_device="$saved_sink"
    configured_ao="${configured_ao:-alsa}"
  fi

  if [[ -n "$configured_ao" ]]; then
    printf '%s\0' "--ao=${configured_ao}"
  fi
  if [[ -n "$configured_device" ]]; then
    printf '%s\0' "--audio-device=${configured_device}"
    return
  fi

  default_sink="$(pactl get-default-sink 2>/dev/null || true)"
  if [[ "$default_sink" == "auto_null" ]] \
    && aplay -L 2>/dev/null | grep -q '^hdmi:CARD=vc4hdmi0,DEV=0$'; then
    printf '%s\0%s\0' \
      "--ao=alsa" \
      "--audio-device=alsa/hdmi:CARD=vc4hdmi0,DEV=0"
  fi
}

mkdir -p "$(dirname "$SOCKET")"
mkdir -p "$(dirname "$MPV_LOG")"
MANGO_MPV_STOP_NO_CANCEL=1 MANGO_MPV_STOP_NO_DISPLAY=1 bash "$SCRIPT_DIR/mpv-stop.sh" 2>/dev/null || true

URL_LABEL="$(python3 -c 'from urllib.parse import urlparse; import sys; u=urlparse(sys.argv[1]); print(f"{u.scheme}://{u.netloc}/<redacted>")' "$URL" 2>/dev/null || echo "http(s)://<redacted>")"
HWDEC="$(detect_hwdec)"
MODE="play"
if $PROBE; then
  MODE="probe"
fi
audio_label="default"
audio_args=()
if ! $PROBE; then
  while IFS= read -r -d '' arg; do
    audio_args+=("$arg")
  done < <(detect_audio_args)
  for ((i = 0; i < ${#audio_args[@]}; i++)); do
    if [[ "${audio_args[$i]}" == "--audio-device" && $((i + 1)) -lt ${#audio_args[@]} ]]; then
      audio_label="${audio_args[$((i + 1))]}"
    elif [[ "${audio_args[$i]}" == --audio-device=* ]]; then
      audio_label="${audio_args[$i]#--audio-device=}"
    fi
  done
fi
echo "mpv-play: $URL_LABEL mode=$MODE live=$LIVE timeout_ms=$TIMEOUT_MS min_duration_sec=$MIN_DURATION_SEC hwdec=$HWDEC audio=${audio_label}"
START_MS="$(now_ms)"
DEADLINE_MS=$((START_MS + TIMEOUT_MS))

mpv_args=(
  --idle=no
  --keep-open=no
  --no-terminal
  --hwdec="$HWDEC"
  --input-ipc-server="$SOCKET"
)
if $PROBE; then
  # Indexer/gate probes must not seize the TV fullscreen.
  mpv_args+=(--vo=null --ao=null --really-quiet)
else
  bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" playback 2>/dev/null || true
  mpv_args+=(--fs "${audio_args[@]}")
  if [[ -n "$START_SEC" && "$START_SEC" =~ ^[0-9]+$ && "$START_SEC" -gt 0 ]]; then
    mpv_args+=(--start="$START_SEC")
  fi
fi
if [[ -n "$AUDIO_URL" ]]; then
  mpv_args+=(--audio-file="$AUDIO_URL")
fi

mpv "${mpv_args[@]}" "$URL" >>"$MPV_LOG" 2>&1 &
MPV_PID=$!
echo "$MPV_PID" >"${HOME}/.cache/mango/mpv.pid"

while [[ "$(now_ms)" -lt "$DEADLINE_MS" ]]; do
  if play_cancelled; then
    echo "FAIL: play cancelled" >&2
    MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
    exit 1
  fi
  if [[ -S "$SOCKET" ]]; then
    REPLY="$(bash "$SCRIPT_DIR/mpv-ipc.sh" get_property playback-time 2>/dev/null || true)"
    PT="$(printf '%s' "$REPLY" | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("data") or 0)' 2>/dev/null || echo 0)"
    if python3 -c "import sys; sys.exit(0 if float('${PT:-0}') > 0 else 1)" 2>/dev/null; then
      if playback_is_real "${PT:-0}"; then
        END_MS="$(now_ms)"
        echo "PASS: ttff_ms=$((END_MS - START_MS))"
        if [[ -x "$REPO_DIR/scripts/lib/couch-activity.sh" ]]; then
          bash "$REPO_DIR/scripts/lib/couch-activity.sh" touch mpv playing >/dev/null 2>&1 || true
        fi
        if $PROBE; then
          MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
        fi
        exit 0
      fi
      DUR="$(mpv_property duration)"
      if ! $LIVE; then
        min_duration="$MIN_DURATION_SEC"
        if $PROBE && ! $MIN_DURATION_SET; then
          min_duration=5
        fi
        if python3 -c "import sys; d=float('${DUR:-0}'); sys.exit(0 if d > 0 and d < float('${min_duration}') else 1)" 2>/dev/null; then
          echo "FAIL: debrid_status_clip duration=${DUR}" >&2
          MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
          exit 1
        fi
      fi
    fi
  fi
  if ! kill -0 "$MPV_PID" 2>/dev/null; then
    if tail -40 "$MPV_LOG" 2>/dev/null | grep -qiE 'copyright infringement|removed from.*debrid|file was removed'; then
      echo "FAIL: debrid_copyright_block" >&2
      MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
      exit 1
    fi
    break
  fi
  sleep 0.2
done

if tail -40 "$MPV_LOG" 2>/dev/null | grep -qiE 'copyright infringement|removed from.*debrid|file was removed'; then
  echo "FAIL: debrid_copyright_block" >&2
  MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
  exit 1
fi

echo "FAIL: mpv did not start playback within ${TIMEOUT_MS}ms" >&2
MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
exit 1
