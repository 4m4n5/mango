#!/usr/bin/env bash
# Send one mpv IPC command. usage: mpv-ipc.sh get_property playback-time

set -euo pipefail

SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
CMD="${1:-}"

[[ -n "$CMD" ]] || { echo "usage: $0 <command> [arg]" >&2; exit 2; }
[[ -S "$SOCKET" ]] || { echo "mpv socket missing: $SOCKET" >&2; exit 1; }

shift || true
PAYLOAD="$(python3 - "$CMD" "$@" <<'PY'
import json
import sys

def coerce(value: str):
    try:
        if value.strip() != "" and value.strip() == str(int(value)):
            return int(value)
    except ValueError:
        pass
    try:
        parsed = float(value)
        if value.strip() != "" and value.strip().lower() not in {"nan", "inf", "+inf", "-inf"}:
            return parsed
    except ValueError:
        pass
    return value

print(json.dumps({"command": [sys.argv[1], *[coerce(arg) for arg in sys.argv[2:]]]}))
PY
)"

echo "$PAYLOAD" | socat - "$SOCKET"
