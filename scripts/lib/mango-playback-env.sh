#!/usr/bin/env bash
# Source couch playback + display policy from voice.env (idempotent).
# Usage: source scripts/lib/mango-playback-env.sh

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "source $0 — do not execute" >&2
  exit 2
fi

_mango_playback_env_loaded="${_mango_playback_env_loaded:-0}"
[[ "$_mango_playback_env_loaded" == "1" ]] && return 0

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-${HOME}/.Xauthority}"

_voice_env="${MANGO_VOICE_ENV:-${HOME}/.config/mango/voice.env}"
if [[ -f "$_voice_env" ]]; then
  # shellcheck disable=SC1090
  source "$_voice_env"
fi

_mango_playback_env_loaded=1
