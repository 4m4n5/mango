#!/usr/bin/env bash
# Start mango orchestrator (Phase 2). Run on Pi or Mac from ~/mango.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ORCH_DIR="$REPO_DIR/src/orchestrator"
VENV="$ORCH_DIR/.venv"

if [[ -z "${MANGO_CONFIG:-}" ]]; then
  if [[ -f /etc/mango/config.yaml ]]; then
    export MANGO_CONFIG=/etc/mango/config.yaml
  elif [[ -f "${HOME}/.config/mango/config.yaml" ]]; then
    export MANGO_CONFIG="${HOME}/.config/mango/config.yaml"
  else
    export MANGO_CONFIG=/etc/mango/config.yaml
  fi
else
  export MANGO_CONFIG
fi

cd "$ORCH_DIR"

bash "$REPO_DIR/scripts/m5-voice/stack/ensure-orchestrator-venv.sh"

# shellcheck disable=SC1091
source "$VENV/bin/activate"

HOST="${MANGO_ORCH_HOST:-0.0.0.0}"
PORT="${MANGO_ORCH_PORT:-8765}"
CERT_DIR="${MANGO_CERT_DIR:-$HOME/.config/mango/certs}"
SSL_CERTFILE="${MANGO_SSL_CERTFILE:-}"
SSL_KEYFILE="${MANGO_SSL_KEYFILE:-}"

if [[ "${MANGO_ORCH_TLS:-0}" == "1" ]]; then
  SSL_CERTFILE="${SSL_CERTFILE:-$CERT_DIR/mango-companion.pem}"
  SSL_KEYFILE="${SSL_KEYFILE:-$CERT_DIR/mango-companion-key.pem}"
fi

args=(python -m orchestrator.main --host "$HOST" --port "$PORT")
if [[ -n "$SSL_CERTFILE" || -n "$SSL_KEYFILE" ]]; then
  if [[ -z "$SSL_CERTFILE" || -z "$SSL_KEYFILE" ]]; then
    echo "Both MANGO_SSL_CERTFILE and MANGO_SSL_KEYFILE are required for TLS" >&2
    exit 1
  fi
  if [[ ! -f "$SSL_CERTFILE" || ! -f "$SSL_KEYFILE" ]]; then
    echo "Missing TLS certs. Run: bash scripts/m5-voice/stack/setup-mkcert.sh" >&2
    exit 1
  fi
  args+=(--ssl-certfile "$SSL_CERTFILE" --ssl-keyfile "$SSL_KEYFILE")
fi

exec "${args[@]}"
