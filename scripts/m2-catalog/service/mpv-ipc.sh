#!/usr/bin/env bash
# Send one mpv IPC command. usage: mpv-ipc.sh get_property playback-time

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
CMD="${1:-}"
ARG="${2:-}"

[[ -n "$CMD" ]] || { echo "usage: $0 <command> [arg]" >&2; exit 2; }
[[ -S "$SOCKET" ]] || { echo "mpv socket missing: $SOCKET" >&2; exit 1; }

if [[ -n "$ARG" ]]; then
  PAYLOAD=$(python3 -c "import json; print(json.dumps({'command':['$CMD','$ARG']}))")
else
  PAYLOAD=$(python3 -c "import json; print(json.dumps({'command':['$CMD']}))")
fi

echo "$PAYLOAD" | socat - "$SOCKET"
