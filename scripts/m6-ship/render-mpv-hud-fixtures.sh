#!/usr/bin/env bash
# Render the production Lua/libass HUD states through mpv on the Pi.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
OUTPUT_DIR="${1:-/tmp/mango-hud-fixtures}"
HUD="$REPO_DIR/scripts/m2-catalog/service/mango-hud.lua"
WORK_DIR="$(mktemp -d /tmp/mango-hud-render.XXXXXX)"
SOCKET="$WORK_DIR/mpv.sock"
MPV_PID=""

cleanup() {
  if [[ -n "$MPV_PID" ]]; then
    kill "$MPV_PID" 2>/dev/null || true
    wait "$MPV_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

command -v mpv >/dev/null || {
  printf 'FAIL: mpv is required\n' >&2
  exit 1
}
[[ -f "$HUD" ]] || {
  printf 'FAIL: HUD script missing: %s\n' "$HUD" >&2
  exit 1
}
mkdir -p "$OUTPUT_DIR"

MANGO_HUD_FIXTURES=1 \
MANGO_PLAYBACK_TITLE="Everything Everywhere All at Once" \
MANGO_PLAYBACK_CONTEXT="S2 E7 · The Long Way Home" \
MANGO_PLAYBACK_KIND="series" \
mpv \
  --no-config \
  --idle=yes \
  --force-window=immediate \
  --geometry=1920x1080 \
  --input-ipc-server="$SOCKET" \
  --script="$HUD" \
  --ao=null \
  --loop-file=inf \
  "av://lavfi:testsrc2=size=1920x1080:rate=24" \
  >"$WORK_DIR/mpv.log" 2>&1 &
MPV_PID="$!"

for _ in {1..80}; do
  [[ -S "$SOCKET" ]] && break
  sleep 0.1
done
[[ -S "$SOCKET" ]] || {
  sed -n '1,120p' "$WORK_DIR/mpv.log" >&2
  printf 'FAIL: mpv IPC socket did not appear\n' >&2
  exit 1
}

send_command() {
  python3 - "$SOCKET" "$1" <<'PY'
import json
import socket
import sys

path, encoded = sys.argv[1:3]
command = json.loads(encoded)
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
    client.settimeout(4)
    client.connect(path)
    client.sendall((json.dumps({"command": command, "request_id": 1}) + "\n").encode())
    data = b""
    while b"\n" not in data:
        data += client.recv(65536)
    payload = json.loads(data.split(b"\n", 1)[0])
    if payload.get("error") != "success":
        raise SystemExit(payload)
PY
}

states=(
  playing paused seek volume buffering live
  streams-normal streams-dense streams-risky streams-unavailable
  streams-checking streams-failed confirmation
)
for state in "${states[@]}"; do
  send_command "[\"script-message\",\"mango-hud-fixture\",\"$state\"]"
  sleep 0.15
  send_command "[\"screenshot-to-file\",\"$OUTPUT_DIR/$state.png\",\"window\"]"
done

python3 - "$OUTPUT_DIR" "${states[@]}" <<'PY'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
missing = [name for name in sys.argv[2:] if not (root / f"{name}.png").is_file()]
if missing:
    raise SystemExit(f"missing rendered fixtures: {', '.join(missing)}")
print(f"PASS: rendered {len(sys.argv) - 2} mpv/libass HUD fixtures to {root}")
PY
