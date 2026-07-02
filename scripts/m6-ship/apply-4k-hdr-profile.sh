#!/usr/bin/env bash
# Apply or revert Mango's M6.3 Stage 2 4K/HDR playback profile on the Pi.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CONFIG_DIR="${MANGO_CONFIG_DIR:-$HOME/.config/mango}"
VOICE_ENV="${CONFIG_DIR}/voice.env"
PROFILE_SRC="${REPO_DIR}/config/catalog-filters.4k-hdr.example.json"
PROFILE_DST="${CONFIG_DIR}/catalog-filters.4k-hdr.json"

usage() {
  cat >&2 <<'EOF'
usage: apply-4k-hdr-profile.sh apply|revert|status [--no-restart]

apply       enable 2160p HDR-preferred stream policy and mpv 3840x2160@60 playback mode
revert      remove Stage 2 stream/display overrides
status      print current Stage 2 config and display status

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

remove_env_keys() {
  local out
  mkdir -p "$CONFIG_DIR"
  touch "$VOICE_ENV"
  out="$(mktemp)"
  grep -vE '^export (MANGO_CATALOG_FILTERS|MANGO_LAUNCHER_DISPLAY_MODE|MANGO_LAUNCHER_DISPLAY_RATE|MANGO_MPV_DISPLAY_MODE|MANGO_MPV_DISPLAY_RATE|MANGO_MPV_DISPLAY_RATE_STRICT|MANGO_MPV_DISPLAY_FALLBACK_MODE|MANGO_MPV_DISPLAY_FALLBACK_RATE|MANGO_MPV_HWDEC|MANGO_PREFERRED_HDR_TAGS|MANGO_PREFERRED_VIDEO_CODECS)=' \
    "$VOICE_ENV" >"$out" || true
  mv "$out" "$VOICE_ENV"
  chmod 600 "$VOICE_ENV" 2>/dev/null || true
}

append_env() {
  local key="$1"
  local value="$2"
  printf 'export %s=%q\n' "$key" "$value" >>"$VOICE_ENV"
}

restart_stack() {
  [[ "$restart" == "1" ]] || return 0
  cd "$REPO_DIR"
  bash scripts/mango-stack.sh restart
}

status() {
  echo "voice_env=$VOICE_ENV"
  if [[ -f "$VOICE_ENV" ]]; then
    grep -E '^export (MANGO_CATALOG_FILTERS|MANGO_LAUNCHER_DISPLAY_MODE|MANGO_LAUNCHER_DISPLAY_RATE|MANGO_MPV_DISPLAY_MODE|MANGO_MPV_DISPLAY_RATE|MANGO_MPV_DISPLAY_RATE_STRICT|MANGO_MPV_DISPLAY_FALLBACK_MODE|MANGO_MPV_DISPLAY_FALLBACK_RATE|MANGO_MPV_HWDEC|MANGO_PREFERRED_HDR_TAGS|MANGO_PREFERRED_VIDEO_CODECS)=' \
      "$VOICE_ENV" || true
  else
    echo "voice_env_missing"
  fi
  echo "profile=$PROFILE_DST"
  if [[ -f "$PROFILE_DST" ]]; then
    python3 - "$PROFILE_DST" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
print(json.dumps({
  "max_quality": data.get("max_quality"),
  "preferred_quality": data.get("preferred_quality"),
  "preferred_hdr_tags": data.get("preferred_hdr_tags"),
  "preferred_video_codecs": data.get("preferred_video_codecs"),
  "exclude_remux": data.get("exclude_remux"),
  "include_uncached": data.get("include_uncached"),
}, sort_keys=True))
PY
  else
    echo "profile_missing"
  fi
  if [[ -x "$REPO_DIR/scripts/lib/mango-display-mode.sh" ]]; then
    bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" status || true
  fi
}

case "$cmd" in
  apply)
    [[ -f "$PROFILE_SRC" ]] || {
      echo "missing profile source: $PROFILE_SRC" >&2
      exit 1
    }
    mkdir -p "$CONFIG_DIR"
    cp "$PROFILE_SRC" "$PROFILE_DST"
    chmod 600 "$PROFILE_DST" 2>/dev/null || true
    remove_env_keys
    append_env MANGO_CATALOG_FILTERS "$PROFILE_DST"
    append_env MANGO_LAUNCHER_DISPLAY_MODE "1920x1080"
    append_env MANGO_LAUNCHER_DISPLAY_RATE "60"
    append_env MANGO_MPV_DISPLAY_MODE "3840x2160"
    append_env MANGO_MPV_DISPLAY_RATE "60"
    append_env MANGO_MPV_DISPLAY_RATE_STRICT "1"
    append_env MANGO_MPV_DISPLAY_FALLBACK_MODE "1920x1080"
    append_env MANGO_MPV_DISPLAY_FALLBACK_RATE "60"
    append_env MANGO_MPV_HWDEC "drm-copy"
    append_env MANGO_PREFERRED_HDR_TAGS "HDR10+,HDR10,HDR"
    append_env MANGO_PREFERRED_VIDEO_CODECS "hevc,x265,h265"
    restart_stack
    status
    ;;
  revert)
    remove_env_keys
    rm -f "$PROFILE_DST"
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
