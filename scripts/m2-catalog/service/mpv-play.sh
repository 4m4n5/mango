#!/usr/bin/env bash
# Start or replace mpv fullscreen. See phase-n1-catalog-play-spike.md §6.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
MPV_LOG="${MANGO_MPV_LOG:-${HOME}/.cache/mango/mpv-play.log}"
VLC_LOG="${MANGO_VLC_LOG:-${HOME}/.cache/mango/vlc-play.log}"
VLC_PID_FILE="${MANGO_VLC_PID_FILE:-${HOME}/.cache/mango/vlc.pid}"
PLAYER_STATE_FILE="${MANGO_PLAYER_STATE_PATH:-${HOME}/.cache/mango/player-state.json}"
VLC_PLAYLIST="${MANGO_VLC_PLAYLIST:-${HOME}/.cache/mango/vlc-play.m3u}"
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

detect_video_profile() {
  local probe_timeout="${MANGO_MPV_FFPROBE_TIMEOUT_SEC:-12}"
  local probe_json
  command -v ffprobe >/dev/null 2>&1 || return 1
  if command -v timeout >/dev/null 2>&1; then
    probe_json="$(timeout "${probe_timeout}s" ffprobe \
      -v error \
      -select_streams v:0 \
      -show_entries stream=width,height,avg_frame_rate,r_frame_rate:format=duration \
      -of json \
      "$URL" 2>/dev/null || true)"
  else
    probe_json="$(ffprobe \
      -v error \
      -select_streams v:0 \
      -show_entries stream=width,height,avg_frame_rate,r_frame_rate:format=duration \
      -of json \
      "$URL" 2>/dev/null || true)"
  fi
  [[ -n "$probe_json" ]] || return 1
  python3 -c '
import json
import sys
from fractions import Fraction

try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)

streams = data.get("streams") or []
if not streams:
    raise SystemExit(1)
stream = streams[0]

def parse_rate(value):
    if not value or value == "0/0":
        return 0.0
    try:
        return float(Fraction(value))
    except Exception:
        try:
            return float(value)
        except Exception:
            return 0.0

width = int(stream.get("width") or 0)
height = int(stream.get("height") or 0)
fps = parse_rate(stream.get("avg_frame_rate")) or parse_rate(stream.get("r_frame_rate"))
if width <= 0 or height <= 0 or fps <= 0:
    raise SystemExit(1)
try:
    duration = float((data.get("format") or {}).get("duration") or 0)
except Exception:
    duration = 0.0
print(f"{width} {height} {fps:.3f} {duration:.3f}")
' <<<"$probe_json"
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

detect_vlc_audio_args() {
  local configured_device="${MANGO_VLC_ALSA_DEVICE:-${MANGO_VLC_AUDIO_DEVICE:-}}"
  local configured_aout="${MANGO_VLC_AOUT:-alsa}"
  local saved_sink="${MANGO_AUDIO_SINK:-}"
  local mpv_device="${MANGO_MPV_AUDIO_DEVICE:-}"

  if [[ -z "$configured_device" && "$saved_sink" == alsa/* ]]; then
    configured_device="${saved_sink#alsa/}"
  fi
  if [[ -z "$configured_device" && "$mpv_device" == alsa/* ]]; then
    configured_device="${mpv_device#alsa/}"
  fi
  if [[ -z "$configured_device" ]] \
    && aplay -L 2>/dev/null | grep -q '^hdmi:CARD=vc4hdmi0,DEV=0$'; then
    configured_device="hdmi:CARD=vc4hdmi0,DEV=0"
  fi

  if [[ -n "$configured_aout" ]]; then
    printf '%s\0' "--aout=${configured_aout}"
  fi
  if [[ -n "$configured_device" ]]; then
    printf '%s\0' "--alsa-audio-device=${configured_device}"
  fi
  printf '%s\0' "--no-spdif"
}

write_vlc_state() {
  local pid="$1"
  local duration="$2"
  local start_sec="${START_SEC:-0}"
  local now
  now="$(now_ms)"
  mkdir -p "$(dirname "$PLAYER_STATE_FILE")"
  python3 - "$PLAYER_STATE_FILE" "$pid" "$now" "${start_sec:-0}" "${duration:-0}" <<'PY'
import json
import sys

path, pid, started_at_ms, start_sec, duration_sec = sys.argv[1:]
payload = {
    "backend": "vlc",
    "pid": int(pid),
    "started_at_ms": int(float(started_at_ms)),
    "start_sec": max(0.0, float(start_sec or 0)),
    "duration_sec": max(0.0, float(duration_sec or 0)),
}
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, separators=(",", ":"))
PY
}

start_vlc_exit_monitor() {
  local pid="$1"
  setsid bash -c '
    pid="$1"
    repo="$2"
    state="$3"
    pid_file="$4"
    playlist="$5"
    while kill -0 "$pid" 2>/dev/null; do
      sleep 1
    done
    if [[ -f "$state" ]] && grep -q "\"pid\":$pid" "$state" 2>/dev/null; then
      curl -s --max-time 2 -X POST "http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}/progress/flush" >/dev/null 2>&1 || true
      rm -f "$state" "$pid_file" "$playlist"
      bash "$repo/scripts/lib/mango-display-mode.sh" launcher >/dev/null 2>&1 || true
      systemctl --user start mango-launcher-chromium.service >/dev/null 2>&1 || true
    fi
  ' bash "$pid" "$REPO_DIR" "$PLAYER_STATE_FILE" "$VLC_PID_FILE" "$VLC_PLAYLIST" >/dev/null 2>&1 &
}

play_with_vlc() {
  local backend="vlc"
  local vlc_bin
  local vlc_pid
  local started_alive_ms
  local vlc_audio_args=()
  local vlc_args=()
  vlc_bin="$(command -v cvlc || command -v vlc || true)"
  if [[ -z "$vlc_bin" ]]; then
    echo "FAIL: vlc backend selected but cvlc/vlc is unavailable" >&2
    exit 1
  fi
  if [[ -n "$AUDIO_URL" ]]; then
    # VLC supports input slaves, but Mango has not validated split A/V streams
    # on the couch path. Keep those rare cases on mpv until explicitly proven.
    echo "FAIL: vlc backend does not support validated split audio streams" >&2
    exit 1
  fi
  if [[ "${video_duration:-0}" != "0" && "$LIVE" == "false" ]]; then
    local min_duration="$MIN_DURATION_SEC"
    if ! python3 - "$video_duration" "$min_duration" <<'PY'
import sys
duration = float(sys.argv[1] or 0)
minimum = float(sys.argv[2] or 0)
raise SystemExit(0 if duration <= 0 or duration >= minimum else 1)
PY
    then
      echo "FAIL: debrid_status_clip duration=${video_duration}" >&2
      exit 1
    fi
  fi

  while IFS= read -r -d '' arg; do
    vlc_audio_args+=("$arg")
  done < <(detect_vlc_audio_args)

  mkdir -p "$(dirname "$VLC_LOG")"
  mkdir -p "$(dirname "$VLC_PID_FILE")"
  printf '#EXTM3U\n%s\n' "$URL" >"$VLC_PLAYLIST"
  chmod 600 "$VLC_PLAYLIST" 2>/dev/null || true

  if [[ "${MANGO_VLC_DISABLE_XCOMPMGR:-1}" == "1" ]]; then
    pkill -x xcompmgr 2>/dev/null || true
  fi
  if [[ "${MANGO_VLC_STOP_LAUNCHER:-1}" == "1" ]]; then
    systemctl --user stop mango-launcher-chromium.service 2>/dev/null || true
  fi

  if [[ -n "$video_width" && -n "$video_height" && -n "$video_fps" ]]; then
    bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" playback-auto "$video_width" "$video_height" "$video_fps" 2>/dev/null || true
  else
    bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" playback 2>/dev/null || true
  fi

  vlc_args=(
    --fullscreen
    --no-video-title-show
    --no-osd
    --play-and-exit
    --no-qt-privacy-ask
    --no-qt-error-dialogs
    "${vlc_audio_args[@]}"
  )
  if [[ -n "$START_SEC" && "$START_SEC" =~ ^[0-9]+$ && "$START_SEC" -gt 0 ]]; then
    vlc_args+=(--start-time "$START_SEC")
  fi

  : >"$VLC_LOG"
  setsid env vblank_mode="${MANGO_VLC_VBLANK_MODE:-1}" \
    MESA_GL_SYNC_TO_VBLANK="${MANGO_VLC_MESA_GL_SYNC_TO_VBLANK:-1}" \
    "$vlc_bin" "${vlc_args[@]}" "$VLC_PLAYLIST" >>"$VLC_LOG" 2>&1 < /dev/null &
  vlc_pid=$!
  echo "$vlc_pid" >"$VLC_PID_FILE"
  write_vlc_state "$vlc_pid" "${video_duration:-0}"
  start_vlc_exit_monitor "$vlc_pid"

  while [[ "$(now_ms)" -lt "$DEADLINE_MS" ]]; do
    if play_cancelled; then
      echo "FAIL: play cancelled" >&2
      MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
      exit 1
    fi
    if ! kill -0 "$vlc_pid" 2>/dev/null; then
      break
    fi
    started_alive_ms=$(( $(now_ms) - START_MS ))
    if [[ "$started_alive_ms" -ge "${MANGO_VLC_TTFF_ASSUME_MS:-2500}" ]]; then
      END_MS="$(now_ms)"
      echo "PASS: ttff_ms=$((END_MS - START_MS)) backend=${backend}"
      if [[ -x "$REPO_DIR/scripts/lib/couch-activity.sh" ]]; then
        bash "$REPO_DIR/scripts/lib/couch-activity.sh" touch vlc playing >/dev/null 2>&1 || true
      fi
      exit 0
    fi
    sleep 0.2
  done

  if tail -40 "$VLC_LOG" 2>/dev/null | grep -qiE 'copyright infringement|removed from.*debrid|file was removed'; then
    echo "FAIL: debrid_copyright_block" >&2
  else
    echo "FAIL: vlc did not start playback within ${TIMEOUT_MS}ms" >&2
  fi
  MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
  exit 1
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
video_label="unknown"
video_width=""
video_height=""
video_fps=""
video_duration="0"
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
  if ! $LIVE && [[ "${MANGO_MPV_MATCH_REFRESH:-1}" != "0" ]]; then
    if profile="$(detect_video_profile 2>/dev/null || true)" && [[ -n "$profile" ]]; then
      read -r video_width video_height video_fps video_duration <<<"$profile"
      video_label="${video_width}x${video_height}@${video_fps}"
    fi
  fi
fi
PLAYBACK_BACKEND="${MANGO_PLAYBACK_BACKEND:-mpv}"
if $PROBE; then
  PLAYBACK_BACKEND="mpv"
fi
echo "mpv-play: $URL_LABEL mode=$MODE backend=$PLAYBACK_BACKEND live=$LIVE timeout_ms=$TIMEOUT_MS min_duration_sec=$MIN_DURATION_SEC hwdec=$HWDEC audio=${audio_label} video=${video_label}"
START_MS="$(now_ms)"
DEADLINE_MS=$((START_MS + TIMEOUT_MS))

if [[ "$PLAYBACK_BACKEND" == "vlc" ]]; then
  play_with_vlc
fi

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
  if [[ -n "$video_width" && -n "$video_height" && -n "$video_fps" ]]; then
    bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" playback-auto "$video_width" "$video_height" "$video_fps" 2>/dev/null || true
  else
    bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" playback 2>/dev/null || true
  fi
  mpv_args+=(--fs "${audio_args[@]}")
  if [[ -n "${MANGO_MPV_VIDEO_SYNC:-display-resample}" ]]; then
    mpv_args+=("--video-sync=${MANGO_MPV_VIDEO_SYNC:-display-resample}")
  fi
  if [[ -n "${MANGO_MPV_INTERPOLATION:-no}" ]]; then
    mpv_args+=("--interpolation=${MANGO_MPV_INTERPOLATION:-no}")
  fi
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
