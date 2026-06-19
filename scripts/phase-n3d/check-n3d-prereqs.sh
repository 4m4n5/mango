#!/usr/bin/env bash
# N3d prerequisites — Pi-local addon stack readiness without printing secrets.

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
WARNS=0
pass() { log "PASS: $*"; }
warn() { log "WARN: $*" >&2; WARNS=$((WARNS + 1)); }
fail() { log "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }

has_listening_port() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -Eq "[:.]${port}[[:space:]]" && return 0
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1 && return 0
  fi
  return 1
}

check_port() {
  local port="$1" label="$2" health_url="${3:-}"
  if ! has_listening_port "$port"; then
    pass "$label port :$port free"
    return 0
  fi
  if [[ -n "$health_url" ]] && curl -sf --max-time 3 "$health_url" >/dev/null 2>&1; then
    pass "$label port :$port already healthy"
    return 0
  fi
  fail "$label port :$port occupied by unknown service"
}

check_config_key_name() {
  local pattern="$1" label="$2" file="${3:-/etc/mango/config.yaml}"
  if [[ ! -f "$file" ]]; then
    fail "missing $file"
    return 0
  fi
  if grep -Eiq "$pattern" "$file"; then
    pass "$label key name present in config"
  else
    fail "$label key name missing from config"
  fi
}

command -v docker >/dev/null 2>&1 && pass "docker binary" || fail "docker missing"
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    pass "docker daemon access"
  else
    fail "docker daemon not reachable; add user to docker group or start Docker"
  fi
fi

check_port 3035 "AIOStreams" "http://127.0.0.1:3035/api/v1/status"
check_port 3036 "AIOLists" "http://127.0.0.1:3036/manifest.json"

check_config_key_name "torbox|tb_" "TorBox"
check_config_key_name "real[-_ ]?debrid|rd_" "Real-Debrid"
check_config_key_name "easynews|usenet" "Easynews"

if [[ "${MANGO_CATALOG:-0}" == "1" ]]; then
  pass "MANGO_CATALOG=1"
else
  fail "MANGO_CATALOG=1 not set; add it to ~/.config/mango/voice.env"
fi

if (( WARNS > 0 )); then
  log "N3d prereqs warnings: $WARNS"
fi
(( ERRORS == 0 ))
