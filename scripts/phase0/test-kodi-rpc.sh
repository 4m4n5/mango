#!/usr/bin/env bash
# Phase 0 — test Kodi JSON-RPC is reachable.
# Usage: bash scripts/phase0/test-kodi-rpc.sh <username> <password>

set -euo pipefail

USER="${1:-}"
PASS="${2:-}"
PORT="${KODI_PORT:-8080}"

if [[ -z "$USER" || -z "$PASS" ]]; then
  echo "Usage: $0 <kodi_username> <kodi_password>"
  echo
  echo "Set these in Kodi: Settings → Services → Control"
  exit 1
fi

URL="http://127.0.0.1:${PORT}/jsonrpc"
PAYLOAD='{"jsonrpc":"2.0","id":1,"method":"JSONRPC.Ping"}'

echo "=== Testing Kodi JSON-RPC at $URL ==="
RESP=$(curl -sf -u "${USER}:${PASS}" -H 'Content-Type: application/json' \
  -d "$PAYLOAD" "$URL") || {
  echo "FAILED — is Kodi running? Is web control enabled on port $PORT?"
  exit 1
}

echo "Response: $RESP"

if echo "$RESP" | grep -q '"result":"pong"'; then
  echo "✓ Kodi JSON-RPC OK"
else
  echo "✗ Unexpected response"
  exit 1
fi
