#!/usr/bin/env bash
# Background 2s poller — writes poll.jsonl in the active diag session.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/diag-log.sh
source "$SCRIPT_DIR/lib/diag-log.sh"

INTERVAL="${MANGO_DIAG_POLL_SEC:-2}"
DIR="$(diag_session_dir)" || {
  echo "poll-state: no active session" >&2
  exit 1
}

OUT="${DIR}/poll.jsonl"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

diag_log poll_start interval_sec="$INTERVAL"

while true; do
  python3 - <<'PY' >>"$OUT"
import json, os, subprocess, time
from pathlib import Path

home = Path(os.environ.get("HOME", "/home/aman"))
env = {
    "DISPLAY": os.environ.get("DISPLAY", ":0"),
    "XAUTHORITY": os.environ.get("XAUTHORITY", str(home / ".Xauthority")),
    "HOME": str(home),
}

def run(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=5)
        return (r.stdout or "").strip()
    except Exception:
        return ""

def alive(pat):
    r = subprocess.run(["pgrep", "-f", pat], capture_output=True, text=True)
    return bool(r.stdout.strip())

wid = run(["xdotool", "getactivewindow"])
name = klass = ""
if wid and wid != "0":
    name = run(["xdotool", "getwindowname", wid])
    klass = run(["xdotool", "getwindowclassname", wid])

row = {
    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "pad": alive("python3.*mango-tv-pad.py"),
    "remapper": alive("input-remapper-daemon") or run(["systemctl", "is-active", "input-remapper"]) == "active",
    "kodi": alive("kodi.bin"),
    "stremio": alive("stremio"),
    "active_wid": wid,
    "active_name": name[:80],
    "active_class": klass[:40],
    "pad_log_last": run(["bash", "-c", "tail -1 /tmp/mango-tv-pad.log 2>/dev/null"])[:120],
}
print(json.dumps(row))
PY
  sleep "$INTERVAL"
done
