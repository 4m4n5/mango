#!/usr/bin/env bash
# Switch Mango's couch playback experience for on-TV A/B testing.
#
#   mpv       -> lightweight unified engine on the Pi 5 hardware path:
#                OpenGL (ES) render, auto-safe hwdec (HEVC zero-copy / H.264
#                software), profile=fast, display-resample, and the tear-free
#                foreground (kill xcompmgr + stop the Chromium launcher during
#                fullscreen, restore on exit). Stream policy: 4k-hdr (HEVC,
#                cached, no REMUX). The proven smooth baseline.
#   mpv-hifi  -> same tear-free engine tuned for 4K SDR fidelity: a large
#                demuxer cache for high-bitrate/REMUX HTTP streams, cheap HDR->SDR
#                tone-mapping (only hit at 1080p fallback), and multichannel HDMI
#                audio (auto-safe). Stream policy: 4k-hifi = 4K SDR hi-fi —
#                cached high-bitrate SDR 4K (HEVC REMUX/encode), require_hevc +
#                exclude_hdr on the 4K steps so 4K stays HW-decodable and never
#                GPU-tone-maps (X11 can't output HDR; 4K HDR tone-map stutters).
#                HDR titles fall through to a 1080p step.
#
# This owns the engine + render + stream-policy env keys in voice.env. The
# display-mode/audio-device base from apply-4k-hdr-profile.sh (launcher 1080p60,
# 4K match mode, HDMI audio) is left intact. NOTE: this also (re)points
# MANGO_CATALOG_FILTERS per experience.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CONFIG_DIR="${MANGO_CONFIG_DIR:-$HOME/.config/mango}"
VOICE_ENV="${CONFIG_DIR}/voice.env"

# Experience-selection keys this script owns (removed before each apply).
ENGINE_KEYS='MANGO_PLAYBACK_BACKEND|MANGO_PLAYBACK_CAPABILITY_PROFILE|MANGO_STREAM_PICKER|MANGO_MPV_HWDEC|MANGO_MPV_VIDEO_SYNC|MANGO_MPV_VIDEO_SYNC_4K|MANGO_MPV_VIDEO_SYNC_4K_MATCHED|MANGO_MPV_VIDEO_SYNC_LIVE|MANGO_MPV_LIVE_CACHE|MANGO_MPV_LIVE_CACHE_SECS|MANGO_MPV_LIVE_READAHEAD_SECS|MANGO_MPV_VOD_SWAPINTERVAL|MANGO_MPV_LIVE_SWAPINTERVAL|MANGO_MPV_LIVE_FRAMEDROP|MANGO_MPV_INTERPOLATION|MANGO_MPV_VO|MANGO_MPV_GPU_API|MANGO_MPV_OPENGL_ES|MANGO_MPV_PROFILE|MANGO_MPV_STOP_LAUNCHER|MANGO_MPV_DISABLE_XCOMPMGR|MANGO_MPV_DEFER_FOREGROUND|MANGO_MPV_TONE_MAPPING|MANGO_MPV_CACHE|MANGO_MPV_CACHE_PAUSE|MANGO_MPV_DEMUXER_MAX_BYTES|MANGO_MPV_DEMUXER_MAX_BACK_BYTES|MANGO_MPV_READAHEAD_SECS|MANGO_MPV_HANDOFF_CACHE_SECS|MANGO_MPV_4K_HANDOFF_CACHE_SECS|MANGO_MPV_HANDOFF_CACHE_WAIT_MS|MANGO_MPV_4K_HANDOFF_CACHE_WAIT_MS|MANGO_MPV_AUDIO_CHANNELS|MANGO_CATALOG_FILTERS'

usage() {
  cat >&2 <<'EOF'
usage: set-playback-engine.sh mpv|mpv-hifi|status [--no-restart]

mpv       lightweight unified mpv, smooth baseline (4k-hdr: HEVC/cached/no-remux)
mpv-hifi  mpv tuned for 4K SDR fidelity: big cache + 5.1 audio, 4k-hifi policy
          (cached high-bitrate SDR 4K HEVC REMUX; HDR falls through to 1080p)
status    print current experience env + stream policy + display status
EOF
  exit 2
}

cmd="${1:-}"
[[ -n "$cmd" ]] || usage
shift || true

restart=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-restart) restart=0; shift ;;
    *) usage ;;
  esac
done

remove_engine_keys() {
  local out
  mkdir -p "$CONFIG_DIR"
  touch "$VOICE_ENV"
  out="$(mktemp)"
  grep -vE "^export (${ENGINE_KEYS})=" "$VOICE_ENV" >"$out" || true
  mv "$out" "$VOICE_ENV"
  chmod 600 "$VOICE_ENV" 2>/dev/null || true
}

append_env() {
  printf 'export %s=%q\n' "$1" "$2" >>"$VOICE_ENV"
}

# Install a catalog-filters profile from config/ into CONFIG_DIR and echo the
# installed path. $1 = short name (e.g. 4k-hdr, 4k-hifi).
ensure_filters() {
  local name="$1"
  local src="${REPO_DIR}/config/catalog-filters.${name}.example.json"
  local dst="${CONFIG_DIR}/catalog-filters.${name}.json"
  mkdir -p "$CONFIG_DIR"
  if [[ -f "$src" ]]; then
    cp "$src" "$dst"
    chmod 600 "$dst" 2>/dev/null || true
  fi
  printf '%s\n' "$dst"
}

sync_filters_etc() {
  # shellcheck source=../lib/catalog-yaml.sh
  source "$REPO_DIR/scripts/lib/catalog-yaml.sh"
  sync_catalog_filters_etc "${1:-}"
}

restart_stack() {
  [[ "$restart" == "1" ]] || return 0
  cd "$REPO_DIR"
  bash scripts/mango-stack.sh restart
}

status() {
  echo "voice_env=$VOICE_ENV"
  if [[ -f "$VOICE_ENV" ]]; then
    grep -E "^export (${ENGINE_KEYS})=" "$VOICE_ENV" || echo "(no experience overrides -> default backend: mpv)"
  else
    echo "voice_env_missing"
  fi
  if [[ -x "$REPO_DIR/scripts/lib/mango-display-mode.sh" ]]; then
    bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" status || true
  fi
}

case "$cmd" in
  mpv)
    remove_engine_keys
    append_env MANGO_PLAYBACK_BACKEND "mpv"
    append_env MANGO_MPV_HWDEC "auto-safe"
    append_env MANGO_MPV_VO "gpu"
    append_env MANGO_MPV_GPU_API "opengl"
    append_env MANGO_MPV_OPENGL_ES "yes"
    append_env MANGO_MPV_PROFILE "fast"
    append_env MANGO_PLAYBACK_CAPABILITY_PROFILE "pi5-x11-mpv-hifi"
    # Default-on kill switch for the in-mpv stream picker. Setting this to 0
    # removes the active candidate snapshot without changing playback.
    append_env MANGO_STREAM_PICKER "1"
    append_env MANGO_MPV_VIDEO_SYNC "display-resample"
    append_env MANGO_MPV_VIDEO_SYNC_4K "display-vdrop"
    append_env MANGO_MPV_VIDEO_SYNC_4K_MATCHED "audio"
    append_env MANGO_MPV_VIDEO_SYNC_LIVE "audio"
    append_env MANGO_MPV_VOD_SWAPINTERVAL "1"
    append_env MANGO_MPV_LIVE_CACHE_SECS "4"
    append_env MANGO_MPV_LIVE_READAHEAD_SECS "2"
    append_env MANGO_MPV_LIVE_SWAPINTERVAL "1"
    append_env MANGO_MPV_LIVE_FRAMEDROP "vo"
    append_env MANGO_MPV_INTERPOLATION "no"
    append_env MANGO_MPV_STOP_LAUNCHER "1"
    append_env MANGO_MPV_DISABLE_XCOMPMGR "1"
    # Deferred foreground handoff: keep launcher visible while mpv buffers, then
    # stop launcher / disable compositor only after real playback begins.
    append_env MANGO_MPV_DEFER_FOREGROUND "1"
    # Both mpv profiles render under X11, where 4K HDR is unplayable (a real 4K
    # HDR10 remux measured 27.7% dropped frames on the Pi, 2026-07-29), so both
    # use the ladder that excludes HDR above 1080p.
    append_env MANGO_CATALOG_FILTERS "$(ensure_filters 4k-hifi)"
    sync_filters_etc "$CONFIG_DIR/catalog-filters.4k-hifi.json"
    restart_stack
    status
    ;;
  mpv-hifi)
    remove_engine_keys
    append_env MANGO_PLAYBACK_BACKEND "mpv"
    append_env MANGO_MPV_HWDEC "auto-safe"
    # Use the shader-based `gpu` VO, NOT `gpu-next`. Verified 2026-07-02 on the
    # Pi: gpu-next (libplacebo) blue-screens on vc4 even with --gpu-api=opengl
    # (audio plays, video is a solid blue frame). The `gpu` VO still performs
    # HDR->SDR tone-mapping via --tone-mapping below, so we keep the fidelity
    # win on the proven-smooth render path.
    append_env MANGO_MPV_VO "gpu"
    append_env MANGO_MPV_GPU_API "opengl"
    append_env MANGO_MPV_OPENGL_ES "yes"
    append_env MANGO_PLAYBACK_CAPABILITY_PROFILE "pi5-x11-mpv-hifi"
    append_env MANGO_STREAM_PICKER "1"
    # profile=fast keeps GPU load low (cheap scalers, static HDR peak) so 4K
    # HEVC REMUX stays smooth; tone-mapping still applies on top of it.
    append_env MANGO_MPV_PROFILE "fast"
    # video-sync at 4K: empirically A/B-tested on the Pi (Dune 2160p23.976 on a
    # 3840x2160@23.976 mode). display-vdrop dropped ~0.53 frames/s vs ~0.93 for
    # audio and ~0.96 for display-resample — it locks to the display vsync and
    # drops (never resamples audio) when the X11 present path slips, which is the
    # smoothest option on this Pi 5 + X11 stack. HD stays on cheap display-resample.
    append_env MANGO_MPV_VIDEO_SYNC "display-resample"
    append_env MANGO_MPV_VIDEO_SYNC_4K "display-vdrop"
    append_env MANGO_MPV_VIDEO_SYNC_4K_MATCHED "audio"
    append_env MANGO_MPV_VIDEO_SYNC_LIVE "audio"
    append_env MANGO_MPV_VOD_SWAPINTERVAL "1"
    append_env MANGO_MPV_LIVE_CACHE_SECS "4"
    append_env MANGO_MPV_LIVE_READAHEAD_SECS "2"
    append_env MANGO_MPV_LIVE_SWAPINTERVAL "1"
    append_env MANGO_MPV_LIVE_FRAMEDROP "vo"
    append_env MANGO_MPV_INTERPOLATION "no"
    append_env MANGO_MPV_TONE_MAPPING "bt.2390"
    # Absorb network jitter on 60-100 Mbps REMUX served over HTTP from debrid.
    append_env MANGO_MPV_CACHE "yes"
    append_env MANGO_MPV_CACHE_PAUSE "yes"
    append_env MANGO_MPV_DEMUXER_MAX_BYTES "512MiB"
    append_env MANGO_MPV_DEMUXER_MAX_BACK_BYTES "128MiB"
    append_env MANGO_MPV_READAHEAD_SECS "60"
    # Hold the launcher until the demuxer has headroom — avoids visible stutter
    # on the first seconds after handoff on high-bitrate 4K REMUX.
    append_env MANGO_MPV_HANDOFF_CACHE_SECS "3"
    append_env MANGO_MPV_4K_HANDOFF_CACHE_SECS "18"
    append_env MANGO_MPV_HANDOFF_CACHE_WAIT_MS "12000"
    append_env MANGO_MPV_4K_HANDOFF_CACHE_WAIT_MS "45000"
    # auto-safe negotiates 5.1 LPCM when the TV/receiver EDID advertises it,
    # stereo downmix otherwise (never breaks stereo-only displays).
    append_env MANGO_MPV_AUDIO_CHANNELS "auto-safe"
    append_env MANGO_MPV_STOP_LAUNCHER "1"
    append_env MANGO_MPV_DISABLE_XCOMPMGR "1"
    # Deferred foreground handoff: keep launcher visible while mpv buffers, then
    # stop launcher / disable compositor only after real playback begins.
    append_env MANGO_MPV_DEFER_FOREGROUND "1"
    append_env MANGO_CATALOG_FILTERS "$(ensure_filters 4k-hifi)"
    sync_filters_etc "$CONFIG_DIR/catalog-filters.4k-hifi.json"
    restart_stack
    status
    ;;
  status)
    status
    ;;
  *)
    usage
    ;;
esac
