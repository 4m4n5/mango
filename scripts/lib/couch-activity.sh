#!/usr/bin/env bash
# Shared Mango couch activity marker. No user content is stored.

set -euo pipefail

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
STATE_PATH="${MANGO_COUCH_ACTIVITY_STATE:-$CACHE_DIR/couch-activity.json}"
IDLE_SEC="${MANGO_COUCH_IDLE_SEC:-1800}"
PLAYBACK_ACTIVE_FILE="${MANGO_PLAYBACK_ACTIVE_FILE:-$CACHE_DIR/playback-active}"
MPV_PID_FILE="${MANGO_MPV_PID_FILE:-$CACHE_DIR/mpv.pid}"
MPV_SOCKET="${MANGO_MPV_SOCKET:-$CACHE_DIR/mpv.sock}"

usage() {
  echo "usage: $0 touch <source> [hint] | status | is-idle" >&2
  exit 2
}

mkdir -p "$CACHE_DIR"

cmd="${1:-}"
shift || true

case "$cmd" in
  touch)
    source="${1:-unknown}"
    hint="${2:-}"
    python3 - "$STATE_PATH" "$source" "$hint" <<'PY'
import json
import os
import stat
import sys
import time
from pathlib import Path

path = Path(sys.argv[1])
source = sys.argv[2][:64]
hint = sys.argv[3][:96]
path.parent.mkdir(parents=True, exist_ok=True)
payload = {
    "ts": int(time.time() * 1000),
    "source": source,
    "hint": hint,
    "pid": os.getpid(),
}
tmp = path.with_suffix(path.suffix + ".tmp")
tmp.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
tmp.replace(path)
PY
    ;;
  status|is-idle)
    python3 - "$STATE_PATH" "$IDLE_SEC" "$cmd" "$PLAYBACK_ACTIVE_FILE" "$MPV_PID_FILE" "$MPV_SOCKET" <<'PY'
import json
import os
import sys
import time
from pathlib import Path

path = Path(sys.argv[1])
idle_sec = int(sys.argv[2])
cmd = sys.argv[3]
_active_path = Path(sys.argv[4])
pid_path = Path(sys.argv[5])
socket_path = Path(sys.argv[6])
now_ms = int(time.time() * 1000)
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    data = {"ts": 0, "source": "none", "hint": ""}
age_sec = max(0, int((now_ms - int(data.get("ts") or 0)) / 1000)) if data.get("ts") else 10**9
pid_active = False
try:
    pid = int(pid_path.read_text(encoding="utf-8").strip())
    os.kill(pid, 0)
    pid_active = pid > 0 and socket_path.exists() and stat.S_ISSOCK(socket_path.stat().st_mode)
except Exception:
    pid_active = False
playback_active = pid_active
idle = (not playback_active) and age_sec >= idle_sec
payload = {
    "ok": True,
    "idle": idle,
    "playback_active": playback_active,
    "age_sec": age_sec,
    "idle_after_sec": idle_sec,
    "source": data.get("source") or "unknown",
    "hint": data.get("hint") or "",
    "ts": data.get("ts") or 0,
    "path": str(path),
}
if cmd == "status":
    print(json.dumps(payload, sort_keys=True))
    raise SystemExit(0)
raise SystemExit(0 if idle else 1)
PY
    ;;
  *)
    usage
    ;;
esac
