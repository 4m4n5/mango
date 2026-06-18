#!/usr/bin/env bash
# Call Kodi JSON-RPC using ~/.config/mango/kodi-rpc.json (or guisettings on Pi).

set -euo pipefail

RPC_CONFIG="${HOME}/.config/mango/kodi-rpc.json"
PORT="${KODI_PORT:-8080}"
URL="http://127.0.0.1:${PORT}/jsonrpc"

load_kodi_rpc_auth() {
  if [[ -f "$RPC_CONFIG" ]]; then
    python3 - "$RPC_CONFIG" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
print(cfg.get("user", "mango"))
print(cfg.get("password", ""))
print(cfg.get("port", 8080))
PY
    return 0
  fi

  python3 - <<'PY'
import xml.etree.ElementTree as ET
from pathlib import Path

path = Path.home() / ".kodi/userdata/guisettings.xml"
if not path.is_file():
    raise SystemExit("missing kodi rpc config")
root = ET.parse(path).getroot()
vals = {}
for setting in root.iter("setting"):
    sid = setting.attrib.get("id")
    if sid in ("services.webserverusername", "services.webserverpassword", "services.webserverport"):
        vals[sid] = setting.text or ""
print(vals.get("services.webserverusername", "mango"))
print(vals.get("services.webserverpassword", ""))
print(vals.get("services.webserverport", "8080"))
PY
}

kodi_rpc() {
  local method=$1
  local params="${2-}"
  local -a creds
  local user pass port

  if [[ -z "$params" ]]; then
    params='{}'
  fi

  if ! mapfile -t creds < <(load_kodi_rpc_auth); then
    echo "! Kodi RPC credentials not found — run: bash scripts/phase0/kodi-enable-rpc.sh mango '<password>'" >&2
    return 1
  fi
  user="${creds[0]:-}"
  pass="${creds[1]:-}"
  port="${creds[2]:-8080}"
  if [[ -z "$user" ]]; then
    echo "! Kodi RPC username missing — run: bash scripts/phase0/kodi-enable-rpc.sh mango '<password>'" >&2
    return 1
  fi

  URL="http://127.0.0.1:${port}/jsonrpc"
  KODI_RPC_URL="$URL" KODI_RPC_USER="$user" KODI_RPC_PASS="$pass" \
    KODI_RPC_METHOD="$method" KODI_RPC_PARAMS="$params" \
    python3 - <<'PY'
import json, os, sys, urllib.request, base64

url = os.environ["KODI_RPC_URL"]
user = os.environ["KODI_RPC_USER"]
password = os.environ["KODI_RPC_PASS"]
method = os.environ["KODI_RPC_METHOD"]
params_raw = os.environ.get("KODI_RPC_PARAMS", "{}")

try:
    params = json.loads(params_raw)
except json.JSONDecodeError:
    params = {}

body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
req = urllib.request.Request(url, data=body, method="POST")
req.add_header("Content-Type", "application/json")
cred = base64.b64encode(f"{user}:{password}".encode()).decode("ascii")
req.add_header("Authorization", f"Basic {cred}")

try:
    with urllib.request.urlopen(req, timeout=8) as resp:
        sys.stdout.write(resp.read().decode())
except Exception as exc:
    print(f'{{"error":{{"message":"{exc}"}},"id":1,"jsonrpc":"2.0"}}', file=sys.stdout)
    sys.exit(1)
PY
}

kodi_process_running() {
  pgrep -x kodi >/dev/null 2>&1 || pgrep -f 'kodi.bin' >/dev/null 2>&1
}

kodi_rpc_ready() {
  kodi_rpc JSONRPC.Ping 2>/dev/null | grep -q '"pong"'
}

wait_for_kodi_rpc() {
  local attempt
  for attempt in $(seq 1 90); do
    if kodi_rpc_ready; then
      return 0
    fi
    sleep 0.2
  done
  echo "! Kodi JSON-RPC not responding on ${URL}" >&2
  return 1
}

kodi_current_window_id() {
  local props
  props=$(kodi_rpc GUI.GetProperties '{"properties":["currentwindow"]}' 2>/dev/null || true)
  echo "$props" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get("result", {}).get("currentwindow", {}).get("id", ""))
except Exception:
    print("")
' 2>/dev/null || true
}

# YouTube addon home uses Kodi window id 10025 (label "Videos").
kodi_youtube_ui_visible() {
  [[ "$(kodi_current_window_id)" == "10025" ]]
}

kodi_youtube_is_open() {
  kodi_youtube_ui_visible
}

kodi_window_is_youtube() {
  kodi_youtube_ui_visible
}

kodi_youtube_wait_visible() {
  local attempt
  for attempt in $(seq 1 30); do
    kodi_youtube_ui_visible && return 0
    sleep 0.2
  done
  return 1
}

kodi_youtube_open() {
  local attempt resp

  if kodi_youtube_ui_visible; then
    return 0
  fi

  for attempt in $(seq 1 8); do
    resp=$(kodi_rpc Addons.ExecuteAddon '{"addonid":"plugin.video.youtube"}' 2>/dev/null || true)
    if echo "$resp" | grep -q '"result":"OK"'; then
      kodi_youtube_wait_visible && return 0
    fi
    sleep 0.25
  done
  return 1
}
