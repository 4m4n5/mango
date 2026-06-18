#!/usr/bin/env bash
# One-shot TV state capture into the active diag session (or --stdout).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/diag-log.sh
source "$SCRIPT_DIR/lib/diag-log.sh"

LABEL="${1:-snapshot}"
if [[ "$LABEL" == label=* ]]; then
  LABEL="${LABEL#label=}"
fi
TO_STDOUT=false
[[ "${1:-}" == "--stdout" ]] && TO_STDOUT=true

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

collect() {
  python3 - "$LABEL" <<'PY'
import json, os, subprocess, sys, time
from pathlib import Path

label = sys.argv[1]
home = Path(os.environ.get("HOME", "/home/aman"))
display = os.environ.get("DISPLAY", ":0")
xauth = os.environ.get("XAUTHORITY", str(home / ".Xauthority"))
env = {"DISPLAY": display, "XAUTHORITY": xauth, "HOME": str(home)}

def run(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=8)
        return (r.stdout or "").strip()
    except Exception as e:
        return f"error:{e}"

def pgrep(pattern):
    try:
        r = subprocess.run(["pgrep", "-af", pattern], capture_output=True, text=True)
        lines = [ln for ln in (r.stdout or "").splitlines() if "pgrep -af" not in ln]
        return lines
    except Exception:
        return []

active = {"wid": "", "name": "", "class": ""}
wid = run(["xdotool", "getactivewindow"])
if wid and wid != "0":
    active["wid"] = wid
    active["name"] = run(["xdotool", "getwindowname", wid])
    active["class"] = run(["xdotool", "getwindowclassname", wid])

windows = []
for cls in ("mango-launcher", "Stremio", "Kodi", "chromium"):
    out = run(["xdotool", "search", "--class", cls])
    for w in out.split():
        windows.append({
            "wid": w,
            "class": run(["xdotool", "getwindowclassname", w]),
            "name": run(["xdotool", "getwindowname", w]),
        })

lock = home / ".cache/mango/launch-launcher.lock"

kodi_window = {}
if pgrep("kodi.bin"):
    rpc = run(["bash", "-lc", f"source {home}/mango/scripts/phase0/lib/kodi-rpc.sh && kodi_rpc GUI.GetProperties '{{\"properties\":[\"currentwindow\"]}}' 2>/dev/null"])
    if rpc and "currentwindow" in rpc:
        kodi_window["raw"] = rpc[:500]
    try:
        import re
        m = re.search(r'"id":(\d+)', rpc or "")
        m2 = re.search(r'"label":"([^"]*)"', rpc or "")
        if m:
            kodi_window["id"] = m.group(1)
        if m2:
            kodi_window["label"] = m2.group(1)
    except Exception:
        pass

geometries = []
for w in windows[:8]:
    geo = run(["xdotool", "getwindowgeometry", "--shell", w["wid"]])
    geometries.append({"wid": w["wid"], "name": w["name"][:40], "geo": geo.replace("\n", " ")})

data = {
    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "label": label,
    "active_window": active,
    "windows": windows[:20],
    "window_geometries": geometries,
    "kodi_window": kodi_window,
    "processes": {
        "mango_tv_pad": pgrep("mango-tv-pad.py"),
        "stremio_bridge": pgrep("stremio-pad-bridge.py"),
        "input_remapper": pgrep("input-remapper"),
        "kodi": pgrep("kodi"),
        "stremio": pgrep("stremio"),
        "poll_diag": pgrep("poll-state.sh"),
    },
    "systemd": {
        "input_remapper": run(["systemctl", "is-active", "input-remapper"]),
        "mango_ui_server": run(["systemctl", "--user", "is-active", "mango-ui-server.service"]),
    },
    "locks": {
        "launch_launcher_lock": lock.exists(),
    },
    "logs_tail": {
        "mango_tv_pad": run(["bash", "-c", "tail -8 /tmp/mango-tv-pad.log 2>/dev/null | tr '\\n' ' | '"]),
        "mango_log": run(["bash", "-c", f"tail -8 {home}/.cache/mango/mango.log 2>/dev/null | tr '\\n' ' | '"]),
        "launch_log": run(["bash", "-c", f"tail -8 {home}/.cache/mango/mango-ui-launch.log 2>/dev/null | tr '\\n' ' | '"]),
    },
    "bluetooth": run(["bluetoothctl", "info", "E4:17:D8:EB:00:44"])[:400],
}
print(json.dumps(data, indent=2))
PY
}

if $TO_STDOUT; then
  collect
  exit 0
fi

DIR="$(diag_session_dir)" || {
  echo "No active diag session — run: bash scripts/diag/start-session.sh" >&2
  exit 1
}

OUT="${DIR}/snapshots/$(date +%H%M%S)-${LABEL}.json"
mkdir -p "${DIR}/snapshots"
collect >"$OUT"
diag_log snapshot label="$LABEL" file="$(basename "$OUT")"
echo "snapshot → $OUT"
