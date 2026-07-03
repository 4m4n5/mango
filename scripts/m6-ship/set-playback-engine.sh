#!/usr/bin/env bash
# Switch Mango's couch playback engine for on-TV A/B testing.
#
#   mpv  -> lightweight unified engine on the Pi 5 hardware path:
#           OpenGL (ES) render, auto-safe hwdec (HEVC zero-copy / H.264
#           software), profile=fast, display-resample, and the tear-free
#           foreground (kill xcompmgr + stop the Chromium launcher during
#           fullscreen, restore on exit). True-position IPC seek via the pad.
#   vlc  -> the previous M6.3 target-TV baseline (drm-copy, audio sync).
#
# This only rewrites the engine-selection env keys in voice.env; the 4K/HDR
# stream + display profile from apply-4k-hdr-profile.sh is left intact. Re-run
# apply-4k-hdr-profile.sh only if you want to reset the whole Stage 2 profile.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CONFIG_DIR="${MANGO_CONFIG_DIR:-$HOME/.config/mango}"
VOICE_ENV="${CONFIG_DIR}/voice.env"

# Engine-selection keys this script owns (removed before each apply).
ENGINE_KEYS='MANGO_PLAYBACK_BACKEND|MANGO_MPV_HWDEC|MANGO_MPV_VIDEO_SYNC|MANGO_MPV_INTERPOLATION|MANGO_MPV_VO|MANGO_MPV_GPU_API|MANGO_MPV_OPENGL_ES|MANGO_MPV_PROFILE|MANGO_MPV_STOP_LAUNCHER|MANGO_MPV_DISABLE_XCOMPMGR'

usage() {
  cat >&2 <<'EOF'
usage: set-playback-engine.sh mpv|vlc|status [--no-restart]

mpv       lightweight unified mpv on the Pi 5 hardware path (tear-free foreground)
vlc       previous target-TV VLC baseline
status    print current engine env + display status
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

restart_stack() {
  [[ "$restart" == "1" ]] || return 0
  cd "$REPO_DIR"
  bash scripts/mango-stack.sh restart
}

status() {
  echo "voice_env=$VOICE_ENV"
  if [[ -f "$VOICE_ENV" ]]; then
    grep -E "^export (${ENGINE_KEYS})=" "$VOICE_ENV" || echo "(no engine overrides -> default backend: mpv)"
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
    append_env MANGO_MPV_VIDEO_SYNC "display-resample"
    append_env MANGO_MPV_INTERPOLATION "no"
    append_env MANGO_MPV_STOP_LAUNCHER "1"
    append_env MANGO_MPV_DISABLE_XCOMPMGR "1"
    restart_stack
    status
    ;;
  vlc)
    remove_engine_keys
    append_env MANGO_PLAYBACK_BACKEND "vlc"
    append_env MANGO_MPV_HWDEC "drm-copy"
    append_env MANGO_MPV_VIDEO_SYNC "audio"
    append_env MANGO_MPV_INTERPOLATION "no"
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
