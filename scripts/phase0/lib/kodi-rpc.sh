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
  local params=${2:-{}}
  local user pass port

  if ! read -r user pass port < <(load_kodi_rpc_auth); then
    echo "! Kodi RPC credentials not found — run: bash scripts/phase0/kodi-enable-rpc.sh mango '<password>'" >&2
    return 1
  fi

  URL="http://127.0.0.1:${port}/jsonrpc"
  curl -s -u "${user}:${pass}" \
    -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"${method}\",\"params\":${params}}" \
    "$URL"
}

wait_for_kodi_rpc() {
  local attempt
  for attempt in $(seq 1 40); do
    if kodi_rpc JSONRPC.Ping | grep -q '"pong"'; then
      return 0
    fi
    sleep 0.5
  done
  echo "! Kodi JSON-RPC not responding on ${URL}" >&2
  return 1
}
