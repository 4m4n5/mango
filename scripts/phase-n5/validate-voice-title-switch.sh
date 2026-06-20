#!/usr/bin/env bash
# Voice navigation: open title A → open title B without manual home/back.
# Run on Pi (or via pi-exec.sh). Requires mango-launcher Chromium kiosk up.
#
# Usage: bash scripts/phase-n5/validate-voice-title-switch.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

LAUNCHER_PORT="${MANGO_LAUNCHER_PORT:-3000}"
CATALOG="${MANGO_CATALOG_UPSTREAM:-http://127.0.0.1:3020}"
BASE="http://127.0.0.1:${LAUNCHER_PORT}"
WAIT_SEC="${MANGO_VOICE_ACK_WAIT_SEC:-12}"
QUERY_A="${MANGO_VOICE_SWITCH_QUERY_A:-Shawshank}"
QUERY_B="${MANGO_VOICE_SWITCH_QUERY_B:-Godfather}"

if ! curl -sf --max-time 3 "${BASE}/api/health" >/dev/null; then
  echo "FAIL: launcher /api/health down"
  exit 1
fi

if ! pgrep -f "chromium.*mango-launcher.*127.0.0.1:${LAUNCHER_PORT}/" >/dev/null; then
  echo "FAIL: mango-launcher Chromium not running"
  exit 1
fi

wait_ack() {
  local seq="$1"
  local action="$2"
  local deadline=$((SECONDS + WAIT_SEC))
  while (( SECONDS < deadline )); do
    local ack_json
    ack_json="$(curl -sf --max-time 3 "${BASE}/api/voice/ack" || echo '{}')"
    if echo "$ack_json" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('seq')==${seq} and d.get('ok') is True and d.get('action')=='${action}' else 1)" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

export BASE CATALOG WAIT_SEC QUERY_A QUERY_B

python3 <<PY
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

base = os.environ.get("BASE", "http://127.0.0.1:3000")
catalog = os.environ.get("CATALOG", "http://127.0.0.1:3020")
wait_sec = float(os.environ.get("WAIT_SEC", "14"))
query_a = os.environ.get("QUERY_A", "Shawshank")
query_b = os.environ.get("QUERY_B", "Godfather")


def fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.load(resp)


def resolve_hit(query: str) -> dict:
    q = urllib.parse.quote(query)
    payload = fetch_json(f"{catalog}/voice/search?q={q}&limit=3")
    hits = payload.get("results") or []
    if not hits:
        raise SystemExit(f"FAIL: no search hits for {query!r}")
    hit = hits[0]
    return {
        "type": hit["type"],
        "id": hit["id"],
        "title": hit["title"],
        "tab": hit.get("tab") or "movies",
    }


def wait_ack(seq: int, action: str) -> bool:
    deadline = time.monotonic() + wait_sec
    while time.monotonic() < deadline:
        try:
            payload = fetch_json(f"{base}/api/voice/ack")
        except Exception:
            time.sleep(0.25)
            continue
        if payload.get("seq") == seq and payload.get("ok") is True and payload.get("action") == action:
            return True
        time.sleep(0.25)
    return False


def launcher_is_foreground() -> bool:
    try:
        proc = subprocess.run(
            ["xdotool", "getactivewindow", "getwindowname"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    name = (proc.stdout or "").strip().lower()
    return "mango launcher" in name or "mango-launcher" in name


def mpv_is_running() -> bool:
    try:
        proc = subprocess.run(["pgrep", "-x", "mpv"], capture_output=True, check=False)
        return proc.returncode == 0
    except OSError:
        return False


def open_title(hit: dict) -> None:
    body = json.dumps(
        {
            "type": "launcher_command",
            "action": "open_detail",
            "content_type": hit["type"],
            "id": hit["id"],
            "title": hit["title"],
            "tab": hit["tab"],
        }
    ).encode()
    req = urllib.request.Request(
        f"{base}/api/voice/command",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        payload = json.load(resp)
    seq = payload.get("seq")
    if not isinstance(seq, int) or seq <= 0:
        raise SystemExit(f"FAIL: enqueue open_detail returned no seq: {payload}")
    print(f"enqueued open_detail seq={seq} title={hit['title']}")
    if not wait_ack(seq, "open_detail"):
        raise SystemExit(f"FAIL: no ack for seq={seq} title={hit['title']}")
    time.sleep(0.6)
    if mpv_is_running():
        raise SystemExit(
            f"FAIL: mpv still running after voice open for {hit['title']} — TV stays on old playback"
        )
    if not launcher_is_foreground():
        raise SystemExit(
            f"FAIL: launcher not foreground after voice open for {hit['title']} — ack alone is not enough"
        )
    print(f"PASS: ack seq={seq} title={hit['title']} (launcher foreground, mpv stopped)")


hit_a = resolve_hit(query_a)
hit_b = resolve_hit(query_b)
if hit_a["id"] == hit_b["id"]:
    raise SystemExit(f"FAIL: switch test needs two distinct titles (both resolved to {hit_a['id']})")

print(f"=== voice title switch: {hit_a['title']} → {hit_b['title']} ===")
open_title(hit_a)
time.sleep(0.5)
open_title(hit_b)
print("PASS: switched titles without manual home/back")
PY
