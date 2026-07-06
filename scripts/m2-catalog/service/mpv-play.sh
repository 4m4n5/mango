#!/usr/bin/env bash
# Start or replace mpv fullscreen. See phase-n1-catalog-play-spike.md §6.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
MPV_LOG="${MANGO_MPV_LOG:-${HOME}/.cache/mango/mpv-play.log}"
VLC_LOG="${MANGO_VLC_LOG:-${HOME}/.cache/mango/vlc-play.log}"
VLC_PID_FILE="${MANGO_VLC_PID_FILE:-${HOME}/.cache/mango/vlc.pid}"
PLAYER_STATE_FILE="${MANGO_PLAYER_STATE_PATH:-${HOME}/.cache/mango/player-state.json}"
VLC_PLAYLIST="${MANGO_VLC_PLAYLIST:-${HOME}/.cache/mango/vlc-play.m3u}"
PLAYBACK_OSD_PID_FILE="${MANGO_PLAYBACK_OSD_PID_FILE:-${HOME}/.cache/mango/playback-osd.pid}"
PLAYBACK_OSD_LOG="${MANGO_PLAYBACK_OSD_LOG:-${HOME}/.cache/mango/playback-osd.log}"
PLAY_CANCEL_FILE="${MANGO_PLAY_CANCEL_PATH:-${HOME}/.cache/mango/play-cancel.epoch}"
PLAYBACK_ACTIVE_FILE="${MANGO_PLAYBACK_ACTIVE_FILE:-${HOME}/.cache/mango/playback-active}"
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
  if is_youtube_stream && ! $LIVE && ! $PROBE; then
    python3 - "$playback_time" <<'PY'
import sys
playback = float(sys.argv[1] or 0)
raise SystemExit(0 if playback >= 0.3 else 1)
PY
    return $?
  fi
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

is_youtube_stream() {
  [[ "$URL" == *"googlevideo.com"* ]] && return 0
  [[ "$URL" == *"youtube.com"* ]] && return 0
  [[ -n "${AUDIO_URL:-}" && "$AUDIO_URL" == *"googlevideo.com"* ]] && return 0
  return 1
}

is_4k_ladder_step() {
  case "${MANGO_PLAY_LADDER_STEP:-}" in
    4k_*|*2160*) return 0 ;;
    *) return 1 ;;
  esac
}

mpv_width_ge_4k() {
  local width="$1"
  [[ "$width" =~ ^[0-9]+$ && "$width" -ge 3000 ]]
}

expects_4k_playback() {
  is_4k_ladder_step && return 0
  mpv_width_ge_4k "${video_width:-}" && return 0
  mpv_width_ge_4k "$(mpv_property width 2>/dev/null || echo 0)" && return 0
  return 1
}

handoff_min_cache_secs() {
  if expects_4k_playback; then
    printf '%s\n' "${MANGO_MPV_4K_HANDOFF_CACHE_SECS:-18}"
    return 0
  fi
  printf '%s\n' "${MANGO_MPV_HANDOFF_CACHE_SECS:-3}"
}

demuxer_cache_ready() {
  local min_secs="${1:-3}"
  local cache
  cache="$(mpv_property demuxer-cache-duration 2>/dev/null || echo 0)"
  python3 - "$cache" "$min_secs" <<'PY'
import sys
cache = float(sys.argv[1] or 0)
minimum = float(sys.argv[2] or 0)
raise SystemExit(0 if cache >= minimum else 1)
PY
}

handoff_cache_wait_exceeded() {
  local ceiling_ms
  if expects_4k_playback; then
    ceiling_ms="${MANGO_MPV_4K_HANDOFF_CACHE_WAIT_MS:-45000}"
  else
    ceiling_ms="${MANGO_MPV_HANDOFF_CACHE_WAIT_MS:-12000}"
  fi
  [[ "$ceiling_ms" =~ ^[0-9]+$ ]] || ceiling_ms=45000
  (( $(now_ms) - START_MS >= ceiling_ms ))
}

playback_handoff_ready() {
  local min_cache
  min_cache="$(handoff_min_cache_secs)"
  demuxer_cache_ready "$min_cache" || handoff_cache_wait_exceeded
}

apply_4k_video_sync() {
  command -v socat >/dev/null 2>&1 || return 0
  [[ -S "$SOCKET" ]] || return 0
  local width sync_4k
  width="$(mpv_property width 2>/dev/null || echo 0)"
  sync_4k="${MANGO_MPV_VIDEO_SYNC_4K:-audio}"
  if [[ -n "${sync_4k}" ]] && mpv_width_ge_4k "$width"; then
    printf '{"command":["set_property","video-sync","%s"]}\n' "$sync_4k" | socat - "$SOCKET" >/dev/null 2>&1 || true
    return 0
  fi
  return 1
}

resolve_playback_video_profile() {
  local attempt profile
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if profile="$(detect_video_profile_mpv 2>/dev/null || true)" && [[ -n "$profile" ]]; then
      printf '%s\n' "$profile"
      return 0
    fi
    if profile="$(detect_video_profile 2>/dev/null || true)" && [[ -n "$profile" ]]; then
      printf '%s\n' "$profile"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

mark_playback_active() {
  mkdir -p "$(dirname "$PLAYBACK_ACTIVE_FILE")"
  : >"$PLAYBACK_ACTIVE_FILE"
}

clear_playback_active() {
  rm -f "$PLAYBACK_ACTIVE_FILE"
}

needs_vo_null_buffer() {
  # Split A/V (--audio-file) cannot use background GPU defer on Pi; keep the
  # null-VO buffer path only for that case.
  [[ -n "${AUDIO_URL:-}" ]]
}

detect_hwdec() {
  if [[ -n "${MANGO_MPV_HWDEC:-}" ]]; then
    printf '%s\n' "$MANGO_MPV_HWDEC"
    return
  fi
  # Pi 5 (BCM2712) has a hardware HEVC decoder but no H.264 block. auto-safe
  # gives HEVC zero-copy drm-prime and cleanly falls back to software for
  # H.264/AV1 — unlike drm-copy, which copies every frame back and stutters at
  # 4K, and unlike forcing hwdec=drm, which cannot map software yuv420p frames
  # (the "blue screen with audio" failure). See docs/PLAYABILITY.md playback.
  if grep -qi 'raspberry pi' /proc/device-tree/model 2>/dev/null; then
    printf '%s\n' "auto-safe"
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

detect_video_profile_mpv() {
  [[ -S "$SOCKET" ]] || return 1
  local width height fps duration reply
  width="$(mpv_property width)"
  height="$(mpv_property height)"
  fps="$(mpv_property container-fps)"
  if python3 -c "import sys; sys.exit(0 if float('${fps:-0}') > 0 else 1)" 2>/dev/null; then
    :
  else
    fps="$(mpv_property estimated-vf-fps)"
  fi
  duration="$(mpv_property duration)"
  python3 - "$width" "$height" "$fps" "$duration" <<'PY'
import sys
try:
    width = int(float(sys.argv[1] or 0))
    height = int(float(sys.argv[2] or 0))
    fps = float(sys.argv[3] or 0)
    duration = float(sys.argv[4] or 0)
except ValueError:
    raise SystemExit(1)
if width <= 0 or height <= 0 or fps <= 0:
    raise SystemExit(1)
print(f"{width} {height} {fps:.3f} {duration:.3f}")
PY
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
    osd_pid_file="$6"
    while kill -0 "$pid" 2>/dev/null; do
      sleep 1
    done
    if [[ -f "$state" ]] && grep -q "\"pid\":$pid" "$state" 2>/dev/null; then
      curl -s --max-time 2 -X POST "http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}/progress/flush" >/dev/null 2>&1 || true
      if [[ -f "$osd_pid_file" ]]; then
        kill "$(cat "$osd_pid_file")" 2>/dev/null || true
        rm -f "$osd_pid_file"
      fi
      rm -f "$state" "$pid_file" "$playlist" "${HOME}/.cache/mango/playback-active"
      bash "$repo/scripts/lib/mango-display-mode.sh" launcher >/dev/null 2>&1 || true
      systemctl --user start mango-launcher-chromium.service >/dev/null 2>&1 || true
    fi
  ' bash "$pid" "$REPO_DIR" "$PLAYER_STATE_FILE" "$VLC_PID_FILE" "$VLC_PLAYLIST" "$PLAYBACK_OSD_PID_FILE" >/dev/null 2>&1 &
}

start_mpv_exit_monitor() {
  # When couch mpv stops the launcher for a tear-free foreground, a natural
  # end-of-file has nothing to bring the launcher back. Mirror the VLC monitor:
  # watch the mpv pid and, if it is still the current play, restore the
  # launcher display mode + Chromium kiosk. An explicit --stop clears mpv.pid
  # first, so this no-ops in that case (mpv-stop.sh handles restore instead).
  local pid="$1"
  local pidfile="${HOME}/.cache/mango/mpv.pid"
  setsid bash -c '
    pid="$1"
    repo="$2"
    pidfile="$3"
    while kill -0 "$pid" 2>/dev/null; do
      sleep 1
    done
    if [[ -f "$pidfile" ]] && [[ "$(cat "$pidfile" 2>/dev/null)" == "$pid" ]]; then
      curl -s --max-time 2 -X POST "http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}/progress/flush" >/dev/null 2>&1 || true
      rm -f "$pidfile" "${HOME}/.cache/mango/playback-active"
      bash "$repo/scripts/lib/mango-display-mode.sh" launcher >/dev/null 2>&1 || true
      systemctl --user start mango-launcher-chromium.service >/dev/null 2>&1 || true
      bash "$repo/scripts/launch-launcher.sh" >/dev/null 2>&1 || true
    fi
  ' bash "$pid" "$REPO_DIR" "$pidfile" >/dev/null 2>&1 &
}

append_mpv_cache_args() {
  local -n args_ref="$1"
  if [[ -n "${MANGO_MPV_CACHE:-}" ]]; then
    args_ref+=(--cache="${MANGO_MPV_CACHE}")
  fi
  if [[ -n "${MANGO_MPV_CACHE_PAUSE:-}" ]]; then
    args_ref+=(--cache-pause="${MANGO_MPV_CACHE_PAUSE}")
  fi
  if [[ -n "${MANGO_MPV_DEMUXER_MAX_BYTES:-}" ]]; then
    args_ref+=(--demuxer-max-bytes="${MANGO_MPV_DEMUXER_MAX_BYTES}")
  fi
  if [[ -n "${MANGO_MPV_DEMUXER_MAX_BACK_BYTES:-}" ]]; then
    args_ref+=(--demuxer-max-back-bytes="${MANGO_MPV_DEMUXER_MAX_BACK_BYTES}")
  fi
  if [[ -n "${MANGO_MPV_READAHEAD_SECS:-}" ]]; then
    args_ref+=(--demuxer-readahead-secs="${MANGO_MPV_READAHEAD_SECS}")
  fi
}

append_mpv_render_args() {
  local -n args_ref="$1"
  # Pi 5 tear-free render path: OpenGL (ES) avoids the mpv 0.40 Vulkan default
  # whose libplacebo DRM-modifier mismatch blue-screens on vc4; profile=fast
  # keeps GPU load low enough for 4K HEVC. All env-overridable for A/B testing.
  args_ref+=("--vo=${MANGO_MPV_VO:-gpu}")
  if [[ -n "${MANGO_MPV_GPU_API:-opengl}" ]]; then
    args_ref+=("--gpu-api=${MANGO_MPV_GPU_API:-opengl}")
  fi
  case "${MANGO_MPV_OPENGL_ES:-yes}" in
    1 | yes | true) args_ref+=(--opengl-es=yes) ;;
  esac
  if [[ -n "${MANGO_MPV_PROFILE:-fast}" ]]; then
    args_ref+=("--profile=${MANGO_MPV_PROFILE:-fast}")
  fi
  if [[ -n "${MANGO_MPV_VIDEO_SYNC:-display-resample}" ]]; then
    local sync="${MANGO_MPV_VIDEO_SYNC:-display-resample}"
    if [[ -n "${MANGO_MPV_VIDEO_SYNC_4K:-}" ]] && {
      is_4k_ladder_step || mpv_width_ge_4k "${video_width:-}"
    }; then
      sync="${MANGO_MPV_VIDEO_SYNC_4K}"
    fi
    args_ref+=("--video-sync=${sync}")
  fi
  if [[ -n "${MANGO_MPV_INTERPOLATION:-no}" ]]; then
    args_ref+=("--interpolation=${MANGO_MPV_INTERPOLATION:-no}")
  fi
  # HDR tone-mapping curve (SDR output only — X11 has no HDR passthrough; the
  # Pi 5 stack tone-maps HDR10/HLG down to SDR). Unset -> mpv default. gpu-next
  # gives the most coherent tone-mapping, so the hifi engine pairs this with
  # --vo=gpu-next.
  if [[ -n "${MANGO_MPV_TONE_MAPPING:-}" ]]; then
    args_ref+=("--tone-mapping=${MANGO_MPV_TONE_MAPPING}")
  fi
  append_mpv_cache_args "$1"
  # Multichannel HDMI audio for REMUX soundtracks. auto-safe negotiates the
  # channel layout the TV/receiver reports over HDMI EDID (5.1 when supported,
  # stereo downmix otherwise) so it never breaks stereo-only displays.
  if [[ -n "${MANGO_MPV_AUDIO_CHANNELS:-}" ]]; then
    args_ref+=("--audio-channels=${MANGO_MPV_AUDIO_CHANNELS}")
  fi
}

append_mpv_buffer_args() {
  local -n args_ref="$1"
  args_ref+=(
    --idle=no
    --keep-open=no
    --no-terminal
    --hwdec="$HWDEC"
    --input-ipc-server="$SOCKET"
    --vo=null
    --ao=null
  )
  append_mpv_cache_args "$1"
  if [[ -n "$START_SEC" && "$START_SEC" =~ ^[0-9]+$ && "$START_SEC" -gt 0 ]]; then
    args_ref+=(--start="$START_SEC")
  fi
  if [[ -n "$AUDIO_URL" ]]; then
    args_ref+=(--audio-file="$AUDIO_URL")
  fi
}

enable_mpv_display_once() {
  command -v socat >/dev/null 2>&1 || return 1
  [[ -S "$SOCKET" ]] || return 1
  printf '{"command":["set_property","vo","%s"]}\n' "${MANGO_MPV_VO:-gpu}" | socat - "$SOCKET" >/dev/null 2>&1 || return 1
  if [[ -n "${MANGO_MPV_GPU_API:-opengl}" ]]; then
    printf '{"command":["set_property","gpu-api","%s"]}\n' "${MANGO_MPV_GPU_API:-opengl}" | socat - "$SOCKET" >/dev/null 2>&1 || true
  fi
  case "${MANGO_MPV_OPENGL_ES:-yes}" in
    1 | yes | true)
      printf '%s\n' '{"command":["set_property","opengl-es",true]}' | socat - "$SOCKET" >/dev/null 2>&1 || true
      ;;
  esac
  if [[ -n "${MANGO_MPV_PROFILE:-fast}" ]]; then
    printf '{"command":["set_property","profile","%s"]}\n' "${MANGO_MPV_PROFILE:-fast}" | socat - "$SOCKET" >/dev/null 2>&1 || true
  fi
  if [[ -n "${MANGO_MPV_VIDEO_SYNC:-display-resample}" ]]; then
    printf '{"command":["set_property","video-sync","%s"]}\n' "${MANGO_MPV_VIDEO_SYNC:-display-resample}" | socat - "$SOCKET" >/dev/null 2>&1 || true
  fi
  if [[ -n "${MANGO_MPV_INTERPOLATION:-no}" ]]; then
    printf '{"command":["set_property","interpolation","%s"]}\n' "${MANGO_MPV_INTERPOLATION:-no}" | socat - "$SOCKET" >/dev/null 2>&1 || true
  fi
  printf '%s\n' '{"command":["set_property","fullscreen",true]}' | socat - "$SOCKET" >/dev/null 2>&1 || return 1
  local ao="" device="" pending_device=false
  for arg in "${audio_args[@]}"; do
    if $pending_device; then
      device="$arg"
      pending_device=false
      continue
    fi
    case "$arg" in
      --ao=*) ao="${arg#--ao=}" ;;
      --audio-device=*) device="${arg#--audio-device=}" ;;
      --audio-device) pending_device=true ;;
    esac
  done
  if [[ -n "$ao" ]]; then
    printf '{"command":["set_property","ao","%s"]}\n' "$ao" | socat - "$SOCKET" >/dev/null 2>&1 || true
  fi
  if [[ -n "$device" ]]; then
    printf '{"command":["set_property","audio-device","%s"]}\n' "$device" | socat - "$SOCKET" >/dev/null 2>&1 || true
  fi
  apply_4k_video_sync
  return 0
}

enable_mpv_display() {
  $DISPLAY_ENABLED && return 0
  local attempt
  for attempt in 1 2 3; do
    if enable_mpv_display_once; then
      DISPLAY_ENABLED=true
      return 0
    fi
    sleep 0.15
  done
  return 1
}

mpv_vo_ready_timeout_ms() {
  local width height
  width="${video_width:-}"
  height="$(mpv_property height 2>/dev/null || true)"
  if [[ -n "$width" && "$width" =~ ^[0-9]+$ && "$width" -ge 3000 ]]; then
    printf '%s\n' 1200
    return 0
  fi
  if [[ -n "$height" && "$height" =~ ^[0-9]+$ && "$height" -ge 1600 ]]; then
    printf '%s\n' 1200
    return 0
  fi
  printf '%s\n' 400
}

wait_mpv_vo_ready() {
  local timeout_ms="${1:-400}"
  local started
  started="$(now_ms)"
  while (( $(now_ms) - started < timeout_ms )); do
    if [[ -S "$SOCKET" ]]; then
      local reply ready
      reply="$(bash "$SCRIPT_DIR/mpv-ipc.sh" get_property vo-configured 2>/dev/null || true)"
      ready="$(printf '%s' "$reply" | python3 -c 'import json,sys
try:
  data=json.load(sys.stdin).get("data")
  print("1" if data in (True, "yes", 1) else "0")
except Exception:
  print("0")' 2>/dev/null || echo 0)"
      if [[ "$ready" == "1" ]]; then
        return 0
      fi
    fi
    sleep 0.025
  done
  return 0
}

append_mpv_play_args() {
  local -n args_ref="$1"
  args_ref+=(
    --idle=no
    --keep-open=no
    --no-terminal
    --hwdec="$HWDEC"
    --input-ipc-server="$SOCKET"
  )
  if $PROBE; then
    # Indexer/gate probes must not seize the TV fullscreen.
    args_ref+=(--vo=null --ao=null --really-quiet)
  else
    args_ref+=(--fs "${audio_args[@]}")
    # Subs off at start; pad X/↑/↓ selects tracks. sub-auto=all so cycle sub
    # can reach any embedded track (default fuzzy only exposes forced subs).
    args_ref+=(
      --sub-visibility=no
      --sid=no
      --sub-auto=all
      --blend-subtitles=yes
      --sub-font-size="${MANGO_MPV_SUB_FONT_SIZE:-52}"
    )
    # Do not pass --focus-on-open=no on the Pi GPU fullscreen path: mpv exits
    # immediately (even without --audio-file). Split A/V uses vo=null buffer instead.
    append_mpv_render_args "$1"
    if [[ -n "$START_SEC" && "$START_SEC" =~ ^[0-9]+$ && "$START_SEC" -gt 0 ]]; then
      args_ref+=(--start="$START_SEC")
    fi
  fi
  if [[ -n "$AUDIO_URL" ]]; then
    args_ref+=(--audio-file="$AUDIO_URL")
  fi
}

raise_mpv_window() {
  local wid
  wid="$(mpv_property wid)"
  if [[ -n "$wid" && "$wid" != "0" ]] && command -v xdotool >/dev/null 2>&1; then
    xdotool windowmap --sync "$wid" 2>/dev/null || true
    xdotool windowraise "$wid" 2>/dev/null || true
  fi
}

foreground_handoff() {
  $HANDOFF_DONE && return 0
  mark_playback_active
  if [[ "${MANGO_MPV_STOP_LAUNCHER:-0}" == "1" ]]; then
    systemctl --user stop mango-launcher-chromium.service 2>/dev/null || true
  fi
  if ! $LIVE \
    && [[ "${MANGO_MPV_MATCH_REFRESH:-1}" != "0" ]] \
    && { [[ -z "$video_width" ]] || [[ -z "$video_height" ]] || [[ -z "$video_fps" ]]; }; then
    if profile="$(resolve_playback_video_profile 2>/dev/null || true)" && [[ -n "$profile" ]]; then
      read -r video_width video_height video_fps video_duration <<<"$profile"
      video_label="${video_width}x${video_height}@${video_fps}"
    fi
  fi
  if [[ -n "$video_width" && -n "$video_height" && -n "$video_fps" ]]; then
    bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" playback-auto "$video_width" "$video_height" "$video_fps" 2>/dev/null || true
  else
    bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" playback 2>/dev/null || true
  fi
  apply_4k_video_sync || true
  if [[ "${MANGO_MPV_DISABLE_XCOMPMGR:-0}" == "1" ]]; then
    pkill -x xcompmgr 2>/dev/null || true
  fi
  if [[ "${MANGO_MPV_STOP_LAUNCHER:-0}" == "1" && -n "${MPV_PID:-}" ]]; then
    start_mpv_exit_monitor "$MPV_PID"
  fi
  HANDOFF_DONE=true
  if ! $PROBE; then
    ensure_playback_osd
  fi
  echo "handoff: ready_ms=$(( $(now_ms) - START_MS ))" >&2
}

ensure_playback_osd() {
  local osd_py="$SCRIPT_DIR/playback-osd.py"
  [[ "${MANGO_PLAYBACK_OSD:-1}" != "0" ]] || return 0
  [[ -x "$osd_py" ]] || return 0
  mkdir -p "$(dirname "$PLAYBACK_OSD_PID_FILE")" "$(dirname "$PLAYBACK_OSD_LOG")"
  if [[ -f "$PLAYBACK_OSD_PID_FILE" ]] && kill -0 "$(cat "$PLAYBACK_OSD_PID_FILE")" 2>/dev/null; then
    return 0
  fi
  rm -f "$PLAYBACK_OSD_PID_FILE"
  setsid env DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" HOME="$HOME" \
    MANGO_REPO_DIR="$REPO_DIR" \
    MANGO_PLAYER_STATE_PATH="$PLAYER_STATE_FILE" \
    MANGO_PLAYBACK_OSD_PID_FILE="$PLAYBACK_OSD_PID_FILE" \
    python3 "$osd_py" --run >>"$PLAYBACK_OSD_LOG" 2>&1 < /dev/null &
  echo "$!" >"$PLAYBACK_OSD_PID_FILE"
}

start_playback_osd() {
  ensure_playback_osd
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
    "--short-jump-size=${MANGO_VLC_SEEK_STEP_SEC:-10}"
    "--medium-jump-size=${MANGO_VLC_BIG_SEEK_STEP_SEC:-120}"
    "--long-jump-size=${MANGO_VLC_LONG_SEEK_STEP_SEC:-300}"
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
  start_playback_osd

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
mark_playback_active
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
  if [[ -z "$video_width" || -z "$video_height" || -z "$video_fps" ]]; then
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
DEFER_FOREGROUND_DEFAULT=0
if [[ "${MANGO_MPV_STOP_LAUNCHER:-0}" == "1" ]]; then
  DEFER_FOREGROUND_DEFAULT=1
fi
DEFER_FOREGROUND="${MANGO_MPV_DEFER_FOREGROUND:-$DEFER_FOREGROUND_DEFAULT}"
if $PROBE || [[ "$PLAYBACK_BACKEND" == "vlc" ]]; then
  DEFER_FOREGROUND=0
fi
if [[ "$PLAYBACK_BACKEND" == "vlc" ]] && ! $LIVE && [[ "${MANGO_MPV_MATCH_REFRESH:-1}" != "0" ]]; then
  if profile="$(detect_video_profile 2>/dev/null || true)" && [[ -n "$profile" ]]; then
    read -r video_width video_height video_fps video_duration <<<"$profile"
    video_label="${video_width}x${video_height}@${video_fps}"
  fi
fi
echo "mpv-play: $URL_LABEL mode=$MODE backend=$PLAYBACK_BACKEND live=$LIVE timeout_ms=$TIMEOUT_MS min_duration_sec=$MIN_DURATION_SEC hwdec=$HWDEC audio=${audio_label} video=${video_label}"
START_MS="$(now_ms)"
DEADLINE_MS=$((START_MS + TIMEOUT_MS))
HANDOFF_DONE=false
DISPLAY_ENABLED=false
NULL_BUFFER=false
GPU_DEFER=false

if [[ "$PLAYBACK_BACKEND" == "vlc" ]]; then
  play_with_vlc
fi

mpv_args=()
if ! $PROBE && [[ "$DEFER_FOREGROUND" == "1" ]]; then
  if needs_vo_null_buffer; then
    append_mpv_buffer_args mpv_args
    NULL_BUFFER=true
  else
    # Single-stream VOD (movies/series): decode on the real GPU VO from the
    # start so we never reinitialize the render pipeline mid-play — the main
    # source of sustained 4K REMUX stutter on Pi. Launcher stays on top until
    # the demuxer has headroom, then we hand off foreground.
    append_mpv_play_args mpv_args
    DISPLAY_ENABLED=true
    GPU_DEFER=true
  fi
else
  append_mpv_play_args mpv_args
  DISPLAY_ENABLED=true
  if ! $PROBE && [[ "$DEFER_FOREGROUND" != "1" ]]; then
    foreground_handoff
  fi
fi
setsid mpv "${mpv_args[@]}" "$URL" >>"$MPV_LOG" 2>&1 < /dev/null &
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
      if ! $PROBE && ! $HANDOFF_DONE; then
        if playback_handoff_ready; then
          if $NULL_BUFFER; then
            if ! enable_mpv_display; then
              echo "FAIL: mpv display enable failed" >&2
              MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
              exit 1
            fi
            wait_mpv_vo_ready "$(mpv_vo_ready_timeout_ms)"
          elif $GPU_DEFER; then
            apply_4k_video_sync
          fi
          raise_mpv_window
          foreground_handoff
        fi
      fi
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
