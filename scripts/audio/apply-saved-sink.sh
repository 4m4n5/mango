#!/usr/bin/env bash
# Re-apply MANGO_AUDIO_SINK from ~/.config/mango/audio.env (call from stack start if needed).

set -euo pipefail

ENV_FILE="${HOME}/.config/mango/audio.env"
[[ -f "$ENV_FILE" ]] || exit 0

# shellcheck disable=SC1090
source "$ENV_FILE"
[[ -n "${MANGO_AUDIO_SINK:-}" ]] || exit 0

bash "$(dirname "$0")/set-default-sink.sh" "$MANGO_AUDIO_SINK"
