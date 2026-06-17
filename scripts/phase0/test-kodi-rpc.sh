#!/usr/bin/env bash
# Test Kodi JSON-RPC. On failure, prints diagnostics.
# Usage: bash scripts/phase0/test-kodi-rpc.sh <username> <password>

set -euo pipefail

USER="${1:-}"
PASS="${2:-}"
PORT="${KODI_PORT:-8080}"

if [[ -z "$USER" || -z "$PASS" ]]; then
  echo "Usage: $0 <kodi_username> <kodi_password>"
  echo
  echo "Enable first: bash scripts/phase0/kodi-enable-rpc.sh <user> <pass>"
  exit 1
fi

URL="http://127.0.0.1:${PORT}/jsonrpc"
PAYLOAD='{"jsonrpc":"2.0","id":1,"method":"JSONRPC.Ping"}'

echo "=== Testing Kodi JSON-RPC at $URL ==="

if ! pgrep -x kodi >/dev/null 2>&1 && ! pgrep -f 'kodi.bin' >/dev/null 2>&1; then
  echo "! Kodi is not running — run: bash scripts/phase0/launch-kodi.sh"
  exit 1
fi

if ! ss -tln 2>/dev/null | grep -q ":${PORT} "; then
  echo "! Nothing listening on port ${PORT}"
  echo "  Run: bash scripts/phase0/kodi-enable-rpc.sh ${USER} '<password>'"
  echo "  Then: killall kodi && bash scripts/phase0/launch-kodi.sh && sleep 5"
  if [[ -f "${HOME}/.kodi/userdata/guisettings.xml" ]]; then
    echo
    echo "  guisettings webserver lines:"
    grep -E 'services.webserver' "${HOME}/.kodi/userdata/guisettings.xml" | head -5 || true
  fi
  exit 1
fi

HTTP_CODE=$(curl -s -o /tmp/mango-kodi-rpc.json -w '%{http_code}' \
  -u "${USER}:${PASS}" -H 'Content-Type: application/json' \
  -d "$PAYLOAD" "$URL" || echo "000")

RESP=$(cat /tmp/mango-kodi-rpc.json 2>/dev/null || true)

echo "HTTP ${HTTP_CODE}"
echo "Response: ${RESP:-<empty>}"

case "$HTTP_CODE" in
  200)
    if echo "$RESP" | grep -q '"result":"pong"'; then
      echo "✓ Kodi JSON-RPC OK"
      exit 0
    fi
    echo "✗ Unexpected JSON body"
    exit 1
    ;;
  401)
    echo "✗ Auth failed — wrong username/password, or re-run kodi-enable-rpc.sh"
    exit 1
    ;;
  000)
    echo "✗ Could not connect — enable RPC: bash scripts/phase0/kodi-enable-rpc.sh"
    exit 1
    ;;
  *)
    echo "✗ HTTP error — check Kodi Services → Control settings"
    exit 1
    ;;
esac
