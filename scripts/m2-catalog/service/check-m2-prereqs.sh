#!/usr/bin/env bash
# N1 prerequisites — exit 0 when catalog stack can run.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"
QUIET="${MANGO_GATE_QUIET:-0}"
log() { [[ "$QUIET" == "1" ]] || echo "$@"; }

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

ERRORS=0
fail() { log "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }

command -v mpv >/dev/null || fail "mpv missing"
command -v socat >/dev/null || fail "socat missing"
command -v node >/dev/null || fail "node missing"
[[ -f /etc/mango/stremio-export.json ]] || fail "missing /etc/mango/stremio-export.json"

if [[ "${MANGO_CATALOG:-0}" == "1" ]]; then
  [[ -f src/catalog-service/dist/index.js ]] || fail "catalog-service dist missing"
  curl -sf --max-time 3 http://127.0.0.1:3020/health >/dev/null \
    || fail "catalog-service :3020 down"
fi

(( ERRORS == 0 ))
