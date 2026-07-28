#!/usr/bin/env bash
# Start or replace mpv fullscreen. See phase-n1-catalog-play-spike.md §6.

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
MPV_LOG="${MANGO_MPV_LOG:-${HOME}/.cache/mango/mpv-play.log}"
PLAYBACK_OSD_PID_FILE="${MANGO_PLAYBACK_OSD_PID_FILE:-${HOME}/.cache/mango/playback-osd.pid}"
PLAYBACK_OSD_LOG="${MANGO_PLAYBACK_OSD_LOG:-${HOME}/.cache/mango/playback-osd.log}"
PLAY_CANCEL_FILE="${MANGO_PLAY_CANCEL_PATH:-${HOME}/.cache/mango/play-cancel.epoch}"
PLAYBACK_ACTIVE_FILE="${MANGO_PLAYBACK_ACTIVE_FILE:-${HOME}/.cache/mango/playback-active}"
PLAYBACK_DISPLAY_MATCHED_FILE="${MANGO_PLAYBACK_DISPLAY_MATCHED_FILE:-${HOME}/.cache/mango/playback-display-matched}"
MPV_PID_FILE="${MANGO_MPV_PID_FILE:-${HOME}/.cache/mango/mpv.pid}"
PLAYBACK_OWNERSHIP_LOCK="${MANGO_PLAYBACK_OWNERSHIP_LOCK:-${HOME}/.cache/mango/playback-owner.lock.d}"
REQUEST_CLASS="${MANGO_PLAY_REQUEST_CLASS:-background}"
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

ISOLATED_PROBE=false
if $PROBE && [[ "${MANGO_MPV_ISOLATED_PROBE:-0}" == "1" ]]; then
  ISOLATED_PROBE=true
  ISOLATED_DIR="${HOME}/.cache/mango"
  SOCKET="${ISOLATED_DIR}/probe-$$.sock"
  MPV_PID_FILE="${ISOLATED_DIR}/probe-$$.pid"
  PLAYBACK_ACTIVE_FILE="${ISOLATED_DIR}/probe-$$.active"
  PLAYBACK_DISPLAY_MATCHED_FILE="${ISOLATED_DIR}/probe-$$.display"
  PLAYBACK_OWNERSHIP_LOCK="${ISOLATED_DIR}/probe-$$.owner.lock.d"
  PLAYBACK_OSD_PID_FILE="${ISOLATED_DIR}/probe-$$.osd.pid"
  export MANGO_MPV_SOCKET="$SOCKET"
  export MANGO_MPV_PID_FILE="$MPV_PID_FILE"
  export MANGO_PLAYBACK_ACTIVE_FILE="$PLAYBACK_ACTIVE_FILE"
  export MANGO_PLAYBACK_DISPLAY_MATCHED_FILE="$PLAYBACK_DISPLAY_MATCHED_FILE"
  export MANGO_PLAYBACK_OWNERSHIP_LOCK="$PLAYBACK_OWNERSHIP_LOCK"
  export MANGO_PLAYBACK_OSD_PID_FILE="$PLAYBACK_OSD_PID_FILE"
  export MANGO_MPV_STOP_NO_DISPLAY=1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
# shellcheck source=../../lib/launcher-power.sh
source "$REPO_DIR/scripts/lib/launcher-power.sh"
AUDIO_ENV="${HOME}/.config/mango/audio.env"
if [[ -f "$AUDIO_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$AUDIO_ENV"
fi

if $STOP; then
  exec bash "$SCRIPT_DIR/mpv-stop.sh"
fi

[[ -n "$URL" ]] || usage
[[ "$TIMEOUT_MS" =~ ^[0-9]+$ ]] || usage
[[ "$MIN_DURATION_SEC" =~ ^[0-9]+$ ]] || usage
[[ "$REQUEST_CLASS" == "user" || "$REQUEST_CLASS" == "background" ]] || usage

now_ms() {
  python3 -c 'import time; print(int(time.time()*1000))'
}

# The script receives only the remaining server budget. Start its one deadline
# before lock wait, ffprobe, mpv startup, handoff, and playback confirmation.
START_MS="$(now_ms)"
DEADLINE_MS=$((START_MS + TIMEOUT_MS))

remaining_budget_ms() {
  local remaining=$((DEADLINE_MS - $(now_ms)))
  (( remaining > 0 )) && printf '%s\n' "$remaining" || printf '0\n'
}

authoritative_playback_active() {
  local tracked_pid=""
  if [[ -f "$MPV_PID_FILE" ]]; then
    tracked_pid="$(tr -dc '0-9' <"$MPV_PID_FILE" 2>/dev/null || true)"
  fi
  if [[ -n "$tracked_pid" ]] && kill -0 "$tracked_pid" 2>/dev/null && [[ -S "$SOCKET" ]]; then
    return 0
  fi
  return 1
}

# Serialize the final active check with mpv replacement. The atomic directory
# lock works on both macOS source tests and Raspberry Pi without another daemon.
release_playback_ownership() {
  local owner=""
  owner="$(cat "$PLAYBACK_OWNERSHIP_LOCK/owner" 2>/dev/null || true)"
  if [[ "$owner" == "$$" ]]; then
    rm -f "$PLAYBACK_OWNERSHIP_LOCK/owner"
    rmdir "$PLAYBACK_OWNERSHIP_LOCK" 2>/dev/null || true
  fi
}

acquire_playback_ownership() {
  local attempts=1
  if [[ "$REQUEST_CLASS" == "user" ]]; then
    local wait_ms="${MANGO_PLAYBACK_OWNERSHIP_WAIT_MS:-15000}"
    [[ "$wait_ms" =~ ^[0-9]+$ ]] || wait_ms=15000
    attempts=$((wait_ms / 100 + 1))
  fi
  local attempt owner
  mkdir -p "$(dirname "$PLAYBACK_OWNERSHIP_LOCK")"
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if mkdir "$PLAYBACK_OWNERSHIP_LOCK" 2>/dev/null; then
      printf '%s\n' "$$" >"$PLAYBACK_OWNERSHIP_LOCK/owner"
      trap release_playback_ownership EXIT
      return 0
    fi
    owner="$(cat "$PLAYBACK_OWNERSHIP_LOCK/owner" 2>/dev/null || true)"
    if [[ -n "$owner" ]] && ! kill -0 "$owner" 2>/dev/null; then
      rm -f "$PLAYBACK_OWNERSHIP_LOCK/owner"
      rmdir "$PLAYBACK_OWNERSHIP_LOCK" 2>/dev/null || true
      continue
    fi
    [[ "$REQUEST_CLASS" == "background" ]] && return 1
    [[ "$(remaining_budget_ms)" -le 100 ]] && return 1
    sleep 0.1
  done
  return 1
}

if ! acquire_playback_ownership; then
  if [[ "$REQUEST_CLASS" == "background" ]]; then
    echo "DEFERRED: foreground_playback_busy"
    exit 75
  else
    echo "FAIL: playback ownership busy" >&2
    exit 1
  fi
fi
if [[ "$REQUEST_CLASS" == "background" ]]; then
  if authoritative_playback_active; then
    echo "DEFERRED: foreground_playback_active"
    exit 75
  fi
else
  if [[ -x "$REPO_DIR/scripts/lib/couch-activity.sh" ]]; then
    bash "$REPO_DIR/scripts/lib/couch-activity.sh" touch mpv play >/dev/null 2>&1 || true
  fi
fi

mpv_property() {
  local property="$1"
  local reply
  reply="$(bash "$SCRIPT_DIR/mpv-ipc.sh" get_property "$property" 2>/dev/null || true)"
  python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("data") or 0)' <<<"$reply" 2>/dev/null || echo 0
}

technical_profile_b64() {
  local width height fps codec profile hwdec transfer duration bitrate
  width="$(mpv_property width)"
  height="$(mpv_property height)"
  fps="$(mpv_property container-fps)"
  codec="$(mpv_property video-codec)"
  profile="$(mpv_property video-params/profile)"
  hwdec="$(mpv_property hwdec-current)"
  transfer="$(mpv_property video-params/gamma)"
  duration="$(mpv_property duration)"
  bitrate="$(mpv_property video-bitrate)"
  python3 - "$width" "$height" "$fps" "$codec" "$profile" "$hwdec" "$transfer" "$duration" "$bitrate" <<'PY'
import base64
import json
import sys

def positive(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None

width, height, fps, codec, profile, hwdec, transfer, duration, bitrate = sys.argv[1:]
payload = {}
for key, value in (
    ("width", positive(width)),
    ("height", positive(height)),
    ("fps", positive(fps)),
    ("duration_sec", positive(duration)),
    ("bitrate_bps", positive(bitrate)),
):
    if value is not None:
        payload[key] = int(value) if key in {"width", "height", "bitrate_bps"} else value
for key, value in (
    ("codec", codec),
    ("profile", profile),
    ("hwdec", hwdec),
    ("color_transfer", transfer),
):
    value = str(value or "").strip()
    if value and value != "0":
        payload[key] = value
transfer_lower = str(transfer or "").lower()
payload["hdr"] = any(token in transfer_lower for token in ("pq", "smpte2084", "hlg", "arib-std-b67"))
encoded = base64.urlsafe_b64encode(
    json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
).decode("ascii").rstrip("=")
print(encoded)
PY
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
  sync_4k="$(resolve_4k_video_sync_value)"
  if [[ -n "${sync_4k}" ]] && mpv_width_ge_4k "$width"; then
    printf '{"command":["set_property","video-sync","%s"]}\n' "$sync_4k" | socat - "$SOCKET" >/dev/null 2>&1 || true
    return 0
  fi
  return 1
}

resolve_4k_video_sync_value() {
  if [[ -f "$PLAYBACK_DISPLAY_MATCHED_FILE" ]]; then
    printf '%s\n' "${MANGO_MPV_VIDEO_SYNC_4K_MATCHED:-audio}"
  else
    printf '%s\n' "${MANGO_MPV_VIDEO_SYNC_4K:-display-vdrop}"
  fi
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

begin_playback_session() {
  # New play session: drop any prior match marker before optional pre-match.
  mkdir -p "$(dirname "$PLAYBACK_ACTIVE_FILE")"
  rm -f "$PLAYBACK_DISPLAY_MATCHED_FILE"
  : >"$PLAYBACK_ACTIVE_FILE"
}

clear_playback_active() {
  rm -f "$PLAYBACK_ACTIVE_FILE"
}

needs_vo_null_buffer() {
  # Buffer path (spawn vo=null, enable GPU VO only after the HDMI match) so the
  # first visible frame is always born on the matched panel. Used for ALL VOD
  # (movies, series episodes, YouTube) — otherwise a browse-res (1080p60) frame
  # shows before the panel refresh-match, producing the "video plays → flash →
  # black → correct mode" start on every tab (not just 4K).
  #
  # Live (IPTV) keeps the immediate GPU VO for fastest tune-in — it renders at
  # browse res and has no fixed source cadence to refresh-match against, so the
  # born-on-match buffering only adds latency with no flash to prevent.
  $LIVE && return 1
  return 0
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
  local probe_json probe_timeout_ms remaining_ms
  command -v ffprobe >/dev/null 2>&1 || return 1
  [[ "$probe_timeout" =~ ^[0-9]+$ ]] || probe_timeout=12
  remaining_ms="$(remaining_budget_ms)"
  (( remaining_ms > 0 )) || return 1
  probe_timeout_ms=$((probe_timeout * 1000))
  (( probe_timeout_ms > remaining_ms )) && probe_timeout_ms="$remaining_ms"
  probe_json="$(python3 - "$probe_timeout_ms" "$URL" <<'PY'
import subprocess
import sys

timeout_ms = max(1, int(sys.argv[1]))
url = sys.argv[2]
try:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate:format=duration",
            "-of", "json", url,
        ],
        capture_output=True,
        text=True,
        timeout=timeout_ms / 1000.0,
        check=False,
    )
except (subprocess.TimeoutExpired, OSError):
    raise SystemExit(1)
if result.returncode == 0:
    sys.stdout.write(result.stdout)
PY
)" || true
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

start_mpv_exit_monitor() {
  # When couch mpv stops the launcher for a tear-free foreground, a natural
  # end-of-file has nothing to bring the launcher back. Watch the mpv pid and,
  # if it is still the current play, run the same black-screen-first stop path
  # as pad ⌂ (mpv-stop.sh). An explicit --stop clears mpv.pid first, so this
  # no-ops (mpv-stop.sh already handled restore).
  local pid="$1"
  local pidfile="$MPV_PID_FILE"
  local expected_epoch="${MANGO_PLAY_EPOCH:-}"
  local cancel_file="$PLAY_CANCEL_FILE"
  setsid bash -c '
    pid="$1"
    repo="$2"
    pidfile="$3"
    expected_epoch="$4"
    cancel_file="$5"
    # pidfd blocks in the kernel for the entire movie instead of waking every
    # 200 ms. Fall back to a conservative one-second loop on older Python/Linux.
    python3 - "$pid" <<"PY" || {
import os
import select
import sys
import time

pid = int(sys.argv[1])
try:
    fd = os.pidfd_open(pid)
except (AttributeError, OSError):
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        except PermissionError:
            pass
        time.sleep(1)
else:
    poller = select.poll()
    poller.register(fd, select.POLLIN)
    poller.poll()
    os.close(fd)
PY
      while kill -0 "$pid" 2>/dev/null; do sleep 1; done
    }
    if [[ -n "$expected_epoch" ]] \
      && [[ "$(tr -d "[:space:]" <"$cancel_file" 2>/dev/null || true)" != "$expected_epoch" ]]; then
      exit 0
    fi
    if [[ -f "$pidfile" ]] && [[ "$(cat "$pidfile" 2>/dev/null)" == "$pid" ]]; then
      MANGO_EXPECTED_MPV_PID="$pid" MANGO_EXPECTED_PLAY_EPOCH="$expected_epoch" \
        MANGO_MPV_STOP_NO_CANCEL=1 MANGO_MPV_STOP_HOME=1 \
        bash "$repo/scripts/m2-catalog/service/mpv-stop.sh" >/dev/null 2>&1 || true
    fi
  ' bash "$pid" "$REPO_DIR" "$pidfile" "$expected_epoch" "$cancel_file" >/dev/null 2>&1 &
}

append_mpv_cache_args() {
  if [[ -n "${MANGO_MPV_CACHE:-}" ]]; then
    mpv_args+=(--cache="${MANGO_MPV_CACHE}")
  fi
  if [[ -n "${MANGO_MPV_CACHE_PAUSE:-}" ]]; then
    mpv_args+=(--cache-pause="${MANGO_MPV_CACHE_PAUSE}")
  fi
  if [[ -n "${MANGO_MPV_DEMUXER_MAX_BYTES:-}" ]]; then
    mpv_args+=(--demuxer-max-bytes="${MANGO_MPV_DEMUXER_MAX_BYTES}")
  fi
  if [[ -n "${MANGO_MPV_DEMUXER_MAX_BACK_BYTES:-}" ]]; then
    mpv_args+=(--demuxer-max-back-bytes="${MANGO_MPV_DEMUXER_MAX_BACK_BYTES}")
  fi
  if [[ -n "${MANGO_MPV_READAHEAD_SECS:-}" ]]; then
    mpv_args+=(--demuxer-readahead-secs="${MANGO_MPV_READAHEAD_SECS}")
  fi
}

# Live IPTV (MPEG-TS) has irregular timestamps; audio master + vsync reduces tearing on Pi.
resolve_video_sync() {
  if $LIVE; then
    printf '%s\n' "${MANGO_MPV_VIDEO_SYNC_LIVE:-audio}"
    return
  fi
  local sync="${MANGO_MPV_VIDEO_SYNC:-display-resample}"
  if {
    is_4k_ladder_step || mpv_width_ge_4k "${video_width:-}"
  }; then
    sync="$(resolve_4k_video_sync_value)"
  fi
  printf '%s\n' "$sync"
}

append_mpv_live_args() {
  $LIVE || return 0
  case "${MANGO_MPV_LIVE_CACHE:-yes}" in
    0 | no | false) return 0 ;;
  esac
  mpv_args+=(--cache=yes)
  mpv_args+=(--cache-secs="${MANGO_MPV_LIVE_CACHE_SECS:-4}")
  mpv_args+=(--cache-pause=yes)
  mpv_args+=(--demuxer-readahead-secs="${MANGO_MPV_LIVE_READAHEAD_SECS:-2}")
  mpv_args+=(--video-latency-hacks=yes)
  case "${MANGO_MPV_LIVE_SWAPINTERVAL:-1}" in
    0 | no | false) ;;
    *) mpv_args+=(--opengl-swapinterval="${MANGO_MPV_LIVE_SWAPINTERVAL:-1}") ;;
  esac
  if [[ -n "${MANGO_MPV_LIVE_FRAMEDROP:-vo}" ]]; then
    mpv_args+=(--framedrop="${MANGO_MPV_LIVE_FRAMEDROP:-vo}")
  fi
}

append_mpv_hud_args() {
  [[ "${MANGO_PLAYBACK_OSD:-1}" != "0" ]] || return 0
  [[ "${MANGO_PLAYBACK_OSD_BACKEND:-lua}" == "lua" ]] || return 0
  local hud_lua="$SCRIPT_DIR/mango-hud.lua"
  [[ -f "$hud_lua" ]] || return 0
  # In-mpv HUD (libass overlay): one window keeps mpv's fullscreen page-flip path
  # intact — no external overlay window to force recompositing and stutter 4K
  # present. Disable the mouse OSC and the native seek bar so nothing else draws
  # over the frame; the pad triggers our HUD via `script-message mango-hud-show`.
  mpv_args+=(
    --script="$hud_lua"
    --osc=no
    --osd-bar=no
  )
}

append_mpv_gpu_startup_args() {
  if [[ -n "${MANGO_MPV_GPU_API:-opengl}" ]]; then
    mpv_args+=("--gpu-api=${MANGO_MPV_GPU_API:-opengl}")
  fi
  case "${MANGO_MPV_OPENGL_ES:-yes}" in
    1 | yes | true) mpv_args+=(--opengl-es=yes) ;;
  esac
  if [[ -n "${MANGO_MPV_PROFILE:-fast}" ]]; then
    mpv_args+=("--profile=${MANGO_MPV_PROFILE:-fast}")
  fi
}

append_mpv_subtitle_startup_args() {
  mpv_args+=(
    --sub-visibility=no
    --sid=no
    --sub-auto=all
    --blend-subtitles="${MANGO_MPV_BLEND_SUBTITLES:-no}"
    --sub-font-size="${MANGO_MPV_SUB_FONT_SIZE:-52}"
  )
}

# Non-display-sensitive VOD policy shared by immediate and vo=null deferred
# startup. Handoff changes only VO/AO/fullscreen and display-sensitive sync.
append_mpv_vod_startup_policy_args() {
  if [[ -n "${MANGO_MPV_TONE_MAPPING:-}" ]]; then
    mpv_args+=("--tone-mapping=${MANGO_MPV_TONE_MAPPING}")
  fi
  if [[ -n "${MANGO_MPV_AUDIO_CHANNELS:-}" ]]; then
    mpv_args+=("--audio-channels=${MANGO_MPV_AUDIO_CHANNELS}")
  fi
  append_mpv_subtitle_startup_args
  append_mpv_cache_args
  case "${MANGO_MPV_VOD_SWAPINTERVAL:-1}" in
    0 | no | false) ;;
    *) mpv_args+=(--opengl-swapinterval="${MANGO_MPV_VOD_SWAPINTERVAL:-1}") ;;
  esac
  append_mpv_hud_args
  if [[ -n "$START_SEC" && "$START_SEC" =~ ^[0-9]+$ && "$START_SEC" -gt 0 ]]; then
    mpv_args+=(--start="$START_SEC")
  fi
}

append_mpv_render_args() {
  local sync
  # Pi 5 tear-free render path: OpenGL (ES) avoids the mpv 0.40 Vulkan default
  # whose libplacebo DRM-modifier mismatch blue-screens on vc4; profile=fast
  # keeps GPU load low enough for 4K HEVC. All env-overridable for A/B testing.
  mpv_args+=("--vo=${MANGO_MPV_VO:-gpu}")
  append_mpv_gpu_startup_args
  sync="$(resolve_video_sync)"
  if [[ -n "$sync" ]]; then
    mpv_args+=("--video-sync=${sync}")
  fi
  if [[ -n "${MANGO_MPV_INTERPOLATION:-no}" ]]; then
    mpv_args+=("--interpolation=${MANGO_MPV_INTERPOLATION:-no}")
  fi
  if ! $LIVE; then
    append_mpv_vod_startup_policy_args
  else
    append_mpv_cache_args
    append_mpv_live_args
  fi
}

append_mpv_buffer_args() {
  mpv_args+=(
    --idle=no
    --keep-open=no
    --no-terminal
    --hwdec="$HWDEC"
    --input-ipc-server="$SOCKET"
    --vo=null
    --ao=null
  )
  append_mpv_gpu_startup_args
  append_mpv_vod_startup_policy_args
  if [[ -n "$AUDIO_URL" ]]; then
    mpv_args+=(--audio-file="$AUDIO_URL")
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
  local sync
  sync="$(resolve_video_sync)"
  if [[ -n "$sync" ]]; then
    printf '{"command":["set_property","video-sync","%s"]}\n' "$sync" | socat - "$SOCKET" >/dev/null 2>&1 || true
  fi
  if [[ -n "${MANGO_MPV_INTERPOLATION:-no}" ]]; then
    printf '{"command":["set_property","interpolation","%s"]}\n' "${MANGO_MPV_INTERPOLATION:-no}" | socat - "$SOCKET" >/dev/null 2>&1 || true
  fi
  printf '%s\n' '{"command":["set_property","fullscreen",true]}' | socat - "$SOCKET" >/dev/null 2>&1 || return 1
  # Deferred VOD starts with ao=null. Explicitly restore mpv's automatic AO
  # selection when no device override exists; otherwise audio remains muted.
  local ao="${MANGO_MPV_AO:-auto}" device="" pending_device=false
  if (( ${#audio_args[@]} > 0 )); then
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
  fi
  printf '{"command":["set_property","ao","%s"]}\n' "$ao" | socat - "$SOCKET" >/dev/null 2>&1 || true
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
  # After HDMI mode switch the GPU VO can take >1s to configure — especially
  # soft-decode 4K. Too-short waits caused "played a moment → flash → stream
  # did not start" on first couch tap (retry often worked once the panel was warm).
  if [[ -n "$width" && "$width" =~ ^[0-9]+$ && "$width" -ge 3000 ]]; then
    printf '%s\n' "${MANGO_MPV_VO_READY_MS_4K:-2500}"
    return 0
  fi
  if [[ -n "$height" && "$height" =~ ^[0-9]+$ && "$height" -ge 1600 ]]; then
    printf '%s\n' "${MANGO_MPV_VO_READY_MS_4K:-2500}"
    return 0
  fi
  printf '%s\n' "${MANGO_MPV_VO_READY_MS:-1200}"
}

wait_mpv_vo_ready() {
  local timeout_ms="${1:-1200}"
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
      # Fallback: frames are leaving the decoder even if vo-configured lags.
      reply="$(bash "$SCRIPT_DIR/mpv-ipc.sh" get_property estimated-vf-fps 2>/dev/null || true)"
      ready="$(printf '%s' "$reply" | python3 -c 'import json,sys
try:
  data=json.load(sys.stdin).get("data")
  print("1" if isinstance(data,(int,float)) and float(data) > 0 else "0")
except Exception:
  print("0")' 2>/dev/null || echo 0)"
      if [[ "$ready" == "1" ]]; then
        return 0
      fi
    fi
    sleep 0.05
  done
  return 1
}

append_mpv_play_args() {
  mpv_args+=(
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
    mpv_args+=(--fs)
    if (( ${#audio_args[@]} > 0 )); then
      mpv_args+=("${audio_args[@]}")
    fi
    # Subs off at start; pad X/•/↑ for subs/OSD. sub-auto=all so cycle sub
    # can reach any embedded track (default fuzzy only exposes forced subs).
    # blend-subtitles=yes stalls 4K present when audio is decoded (~2.5 drops/s
    # on Pi 5 / X11 EGL); ASS overlay path is fine. Override with
    # MANGO_MPV_BLEND_SUBTITLES=yes only for A/B.
    if $LIVE; then
      append_mpv_subtitle_startup_args
      append_mpv_hud_args
      if [[ -n "$START_SEC" && "$START_SEC" =~ ^[0-9]+$ && "$START_SEC" -gt 0 ]]; then
        mpv_args+=(--start="$START_SEC")
      fi
    fi
    # Do not pass --focus-on-open=no on the Pi GPU fullscreen path: mpv exits
    # immediately (even without --audio-file). Split A/V uses vo=null buffer instead.
    append_mpv_render_args
  fi
  if [[ -n "$AUDIO_URL" ]]; then
    mpv_args+=(--audio-file="$AUDIO_URL")
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

# Apply source-matched HDMI before first reveal when profile is known.
# Returns 0 when a match was attempted (caller may settle briefly).
pre_match_playback_display() {
  local width="${1:-}" height="${2:-}" fps="${3:-}"
  [[ "${MANGO_MPV_MATCH_REFRESH:-1}" != "0" ]] || return 1
  [[ -n "$width" && -n "$height" && -n "$fps" && "$fps" != "0" ]] || return 1
  if [[ -f "$PLAYBACK_DISPLAY_MATCHED_FILE" ]]; then
    return 1
  fi
  bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" playback-auto "$width" "$height" "$fps" 2>/dev/null || true
  [[ -f "$PLAYBACK_DISPLAY_MATCHED_FILE" ]]
}

settle_after_display_match() {
  local ms="${MANGO_MPV_DISPLAY_MATCH_SETTLE_MS:-400}"
  [[ "$ms" =~ ^[0-9]+$ ]] || ms=400
  (( ms > 0 )) || return 0
  # Brief blank while the TV finishes HDMI mode switch — prefer correct first frame.
  python3 - "$ms" <<'PY'
import sys, time
time.sleep(max(0, int(sys.argv[1])) / 1000.0)
PY
}

foreground_handoff() {
  $HANDOFF_DONE && return 0
  mark_playback_active
  # Black-screen-first BEFORE HDMI match: never switch to 4K while the
  # launcher is still mapped (that caused the 4K-scaled Chromium flash).
  if [[ "${MANGO_MPV_STOP_LAUNCHER:-0}" == "1" ]]; then
    if bash "$REPO_DIR/scripts/lib/mango-window.sh" hide 2>/dev/null; then
      launcher_freeze || true
    else
      systemctl --user stop mango-launcher-chromium.service 2>/dev/null || true
    fi
  fi
  bash "$REPO_DIR/scripts/lib/mango-desktop.sh" hide 2>/dev/null || true
  if ! $LIVE \
    && [[ "${MANGO_MPV_MATCH_REFRESH:-1}" != "0" ]] \
    && { [[ -z "$video_width" ]] || [[ -z "$video_height" ]] || [[ -z "$video_fps" ]]; }; then
    if profile="$(resolve_playback_video_profile 2>/dev/null || true)" && [[ -n "$profile" ]]; then
      read -r video_width video_height video_fps video_duration <<<"$profile"
      video_label="${video_width}x${video_height}@${video_fps}"
    fi
  fi
  # HDMI SSOT: match only after launcher is hidden + root is black.
  if [[ ! -f "$PLAYBACK_DISPLAY_MATCHED_FILE" ]]; then
    if [[ -n "$video_width" && -n "$video_height" && -n "$video_fps" ]]; then
      if pre_match_playback_display "$video_width" "$video_height" "$video_fps"; then
        settle_after_display_match
      fi
    else
      bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" playback 2>/dev/null || true
    fi
  fi
  # Buffer path: bring up the GPU VO only now — the launcher is hidden, the root
  # is black, and the panel is already at the target (4K) mode — so the first
  # visible frame is born on the matched panel. Enabling the VO earlier (before
  # the HDMI match) is what produced the "browse-res video → flash → black → 4K"
  # start on both debrid 4K and YouTube.
  if $NULL_BUFFER && ! $DISPLAY_ENABLED; then
    local vo_attempt vo_timeout
    vo_timeout="$(mpv_vo_ready_timeout_ms)"
    for vo_attempt in 1 2 3; do
      if ! enable_mpv_display; then
        echo "WARN: mpv display enable attempt ${vo_attempt} failed" >&2
        sleep 0.2
        DISPLAY_ENABLED=false
        continue
      fi
      if wait_mpv_vo_ready "$vo_timeout"; then
        break
      fi
      echo "WARN: mpv vo not ready after display enable (attempt ${vo_attempt}, timeout_ms=${vo_timeout})" >&2
      # Force another enable cycle — first post-HDMI-switch attempt is flaky.
      DISPLAY_ENABLED=false
      sleep 0.25
      if [[ "$vo_attempt" -eq 3 ]]; then
        echo "FAIL: mpv vo not ready after display enable" >&2
        return 1
      fi
      # Grow patience on later attempts.
      vo_timeout=$((vo_timeout + 800))
    done
    if ! $DISPLAY_ENABLED; then
      echo "FAIL: mpv display enable failed" >&2
      return 1
    fi
  fi
  raise_mpv_window
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
  # Default HUD is the in-mpv Lua overlay (loaded via --script in the mpv args);
  # it needs no external daemon. Ensure no legacy Tk overlay lingers — a separate
  # window over fullscreen mpv would break page-flip and stutter present.
  if [[ "${MANGO_PLAYBACK_OSD_BACKEND:-lua}" != "tk" ]]; then
    pkill -f 'playback-osd\.py --run' 2>/dev/null || true
    rm -f "$PLAYBACK_OSD_PID_FILE" 2>/dev/null || true
    return 0
  fi
  [[ -x "$osd_py" ]] || return 0
  mkdir -p "$(dirname "$PLAYBACK_OSD_PID_FILE")" "$(dirname "$PLAYBACK_OSD_LOG")"
  if [[ -f "$PLAYBACK_OSD_PID_FILE" ]]; then
    local osd_pid
    osd_pid="$(cat "$PLAYBACK_OSD_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$osd_pid" ]] && kill -0 "$osd_pid" 2>/dev/null; then
      return 0
    fi
  fi
  if pgrep -f 'playback-osd\.py --run' >/dev/null 2>&1; then
    pkill -f 'playback-osd\.py --run' 2>/dev/null || true
    sleep 0.1
  fi
  rm -f "$PLAYBACK_OSD_PID_FILE"
  setsid env DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" HOME="$HOME" \
    MANGO_REPO_DIR="$REPO_DIR" \
    MANGO_PLAYBACK_OSD_PID_FILE="$PLAYBACK_OSD_PID_FILE" \
    python3 "$osd_py" --run >>"$PLAYBACK_OSD_LOG" 2>&1 < /dev/null &
  echo "$!" >"$PLAYBACK_OSD_PID_FILE"
}

start_playback_osd() {
  ensure_playback_osd
}

mkdir -p "$(dirname "$SOCKET")"
mkdir -p "$(dirname "$MPV_LOG")"
if [[ "$REQUEST_CLASS" == "user" ]] && ! $ISOLATED_PROBE; then
  MANGO_MPV_STOP_NO_CANCEL=1 MANGO_MPV_STOP_NO_DISPLAY=1 \
    bash "$SCRIPT_DIR/mpv-stop.sh" 2>/dev/null || true
fi
if [[ "$REQUEST_CLASS" == "user" ]] && ! $PROBE && ! $ISOLATED_PROBE; then
  begin_playback_session
fi

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
  if [[ "${MANGO_MPV_SKIP_FFPROBE:-0}" != "1" ]] \
    && [[ -z "$video_width" || -z "$video_height" || -z "$video_fps" ]]; then
    if profile="$(detect_video_profile 2>/dev/null || true)" && [[ -n "$profile" ]]; then
      read -r video_width video_height video_fps video_duration <<<"$profile"
      video_label="${video_width}x${video_height}@${video_fps}"
    fi
  fi
  # HDMI match happens in foreground_handoff AFTER launcher hide + black root
  # (never while Chromium is mapped — that caused the 4K-scaled launcher flash).
fi
if (( $(remaining_budget_ms) <= 0 )); then
  echo "FAIL: play deadline exhausted before mpv startup" >&2
  exit 1
fi
DEFER_FOREGROUND_DEFAULT=0
if [[ "${MANGO_MPV_STOP_LAUNCHER:-0}" == "1" ]]; then
  DEFER_FOREGROUND_DEFAULT=1
fi
DEFER_FOREGROUND="${MANGO_MPV_DEFER_FOREGROUND:-$DEFER_FOREGROUND_DEFAULT}"
if $PROBE; then
  DEFER_FOREGROUND=0
fi
echo "mpv-play: $URL_LABEL mode=$MODE backend=mpv live=$LIVE timeout_ms=$TIMEOUT_MS min_duration_sec=$MIN_DURATION_SEC hwdec=$HWDEC audio=${audio_label} video=${video_label}"
HANDOFF_DONE=false
DISPLAY_ENABLED=false
NULL_BUFFER=false
GPU_DEFER=false

mpv_args=()
if ! $PROBE && [[ "$DEFER_FOREGROUND" == "1" ]]; then
  if needs_vo_null_buffer; then
    append_mpv_buffer_args
    NULL_BUFFER=true
  else
    # Single-stream VOD (movies/series): decode on the real GPU VO from the
    # start so we never reinitialize the render pipeline mid-play — the main
    # source of sustained 4K REMUX stutter on Pi. Launcher stays on top at
    # browse 1080p until demuxer headroom; HDMI match runs only at handoff
    # after hide+black (no 4K-scaled launcher flash).
    append_mpv_play_args
    DISPLAY_ENABLED=true
    GPU_DEFER=true
  fi
else
  append_mpv_play_args
  DISPLAY_ENABLED=true
  if ! $PROBE && [[ "$DEFER_FOREGROUND" != "1" ]]; then
    foreground_handoff
  fi
fi
if [[ "${MANGO_MPV_PRINT_ARGS:-0}" == "1" ]]; then
  printf '%s\n' "${mpv_args[@]}"
  clear_playback_active
  exit 0
fi
if [[ "${MANGO_MPV_PARENT_SCOPED_GROUP:-0}" == "1" ]]; then
  mpv "${mpv_args[@]}" "$URL" >>"$MPV_LOG" 2>&1 < /dev/null &
else
  setsid mpv "${mpv_args[@]}" "$URL" >>"$MPV_LOG" 2>&1 < /dev/null &
fi
MPV_PID=$!
echo "$MPV_PID" >"$MPV_PID_FILE"

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
        if play_cancelled; then
          echo "FAIL: play cancelled" >&2
          MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
          exit 1
        fi
        if playback_handoff_ready; then
          # foreground_handoff order (buffer path): hide launcher → black root →
          # HDMI match → enable GPU VO on the matched panel → raise. This keeps
          # the first visible frame on the 4K panel (no browse-res flash).
          if ! foreground_handoff; then
            echo "FAIL: mpv handoff failed" >&2
            MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
            exit 1
          fi
        fi
      fi
      if playback_is_real "${PT:-0}"; then
        # Deferred couch path: never PASS/exit before hide→black→HDMI match→raise.
        # Otherwise 4K remux can decode on a stuck 1080p panel (full stutter) and
        # the exit monitor never starts. Wait until handoff completes (or timeout).
        if ! $PROBE && [[ "$DEFER_FOREGROUND" == "1" ]] && ! $HANDOFF_DONE; then
          :
        else
          if play_cancelled; then
            echo "FAIL: play cancelled" >&2
            MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
            exit 1
          fi
          END_MS="$(now_ms)"
          DUR="$(mpv_property duration)"
          TECHNICAL_B64="$(technical_profile_b64 2>/dev/null || true)"
          echo "PASS: ttff_ms=$((END_MS - START_MS)) duration_sec=${DUR:-0} technical_b64=${TECHNICAL_B64:-e30} failure_class=none"
          if [[ "$REQUEST_CLASS" == "user" ]] && [[ -x "$REPO_DIR/scripts/lib/couch-activity.sh" ]]; then
            bash "$REPO_DIR/scripts/lib/couch-activity.sh" touch mpv playing >/dev/null 2>&1 || true
          fi
          if $PROBE; then
            MANGO_MPV_STOP_NO_CANCEL=1 bash "$SCRIPT_DIR/mpv-stop.sh" >/dev/null 2>&1 || true
          fi
          exit 0
        fi
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
