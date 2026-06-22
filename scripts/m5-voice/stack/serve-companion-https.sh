#!/usr/bin/env bash
# Build and serve the mango companion over HTTPS for phone microphone access.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPANION_DIR="$REPO_DIR/src/companion"
CERT_DIR="${MANGO_CERT_DIR:-$HOME/.config/mango/certs}"
CERTFILE="${MANGO_SSL_CERTFILE:-$CERT_DIR/mango-companion.pem}"
KEYFILE="${MANGO_SSL_KEYFILE:-$CERT_DIR/mango-companion-key.pem}"
HOST="${MANGO_COMPANION_HOST:-0.0.0.0}"
PORT="${MANGO_COMPANION_PORT:-3001}"

if [[ ! -f "$CERTFILE" || ! -f "$KEYFILE" ]]; then
  echo "Missing TLS certs. Run: bash scripts/m5-voice/stack/setup-mkcert.sh" >&2
  exit 1
fi

if [[ ! -d "$COMPANION_DIR/node_modules" ]]; then
  npm --prefix "$COMPANION_DIR" install
fi
npm --prefix "$COMPANION_DIR" run build

exec python3 "$SCRIPT_DIR/serve_https.py" \
  --directory "$COMPANION_DIR/dist" \
  --host "$HOST" \
  --port "$PORT" \
  --certfile "$CERTFILE" \
  --keyfile "$KEYFILE"
