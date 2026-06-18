#!/usr/bin/env bash
# Phase 1 TV health check — curl /api/health + local probes.
#   bash scripts/verify-tv.sh
#   bash scripts/verify-tv.sh --quiet --repair-server   # watchdog

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
PORT="${MANGO_LAUNCHER_PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

QUIET=false
JSON_ONLY=false
REPAIR_SERVER=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quiet) QUIET=true; shift ;;
    --json) JSON_ONLY=true; shift ;;
    --repair-server) REPAIR_SERVER=true; shift ;;
    -h | --help)
      echo "usage: $0 [--quiet] [--json] [--repair-server]"
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# shellcheck source=lib/mango-log.sh
source "$REPO_DIR/scripts/lib/mango-log.sh" 2>/dev/null || mango_log() { :; }

pass() { $QUIET || echo "✓ $*"; }
fail() { $QUIET || echo "✗ $*" >&2; }
warn() { $QUIET || echo "! $*"; }

ERRORS=0
bump_fail() { ERRORS=$((ERRORS + 1)); }

fetch_health() {
  curl -sf --max-time 3 "$HEALTH_URL" 2>/dev/null || echo '{"ok":false,"checks":{}}'
}

HEALTH_JSON="$(fetch_health)"

eval "$(python3 - "$HEALTH_JSON" <<'PY'
import json, sys
try:
    data = json.loads(sys.argv[1])
except json.JSONDecodeError:
    data = {"ok": False, "checks": {}}
ok = bool(data.get("ok"))
checks = data.get("checks") or {}
print(f"API_OK={'1' if ok else '0'}")
for key, val in checks.items():
    if isinstance(val, bool):
        safe = "true" if val else "false"
    else:
        safe = str(val).replace("'", "")
    print(f"CHK_{key.upper()}='{safe}'")
PY
)"

if [[ "${API_OK:-0}" == "1" ]]; then
  pass "API /api/health ok"
else
  fail "API /api/health failed"
  bump_fail
fi

for key in launcher_dist chromium input_remapper openbox; do
  var="CHK_${key^^}"
  val="${!var:-}"
  case "$val" in
    true | active | tv_pad) pass "$key: $val" ;;
    false | inactive | "") fail "$key: ${val:-missing}"; bump_fail ;;
    down | unknown) warn "$key: $val (non-fatal)" ;;
    *) warn "$key: $val" ;;
  esac
done

if [[ "${CHK_KODI_RPC:-}" == "up" ]]; then
  pass "kodi_rpc: up"
elif [[ -n "${CHK_KODI_RPC:-}" ]]; then
  warn "kodi_rpc: ${CHK_KODI_RPC} (expected when Kodi idle)"
fi

if $REPAIR_SERVER && (( ERRORS > 0 )); then
  if systemctl --user is-enabled mango-ui-server.service &>/dev/null; then
    mango_log verify_tv action=repair_server reason=health_fail
    systemctl --user restart mango-ui-server.service || true
    sleep 1
    HEALTH_JSON="$(fetch_health)"
    eval "$(python3 - "$HEALTH_JSON" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
print(f"API_OK={'1' if data.get('ok') else '0'}")
PY
)"
    if [[ "${API_OK:-0}" == "1" ]]; then
      pass "repair: mango-ui-server restarted"
      ERRORS=0
    else
      fail "repair: server still unhealthy"
    fi
  else
    warn "repair skipped — systemd unit not enabled (run install-systemd-units.sh)"
  fi
fi

if $JSON_ONLY; then
  python3 - "$HEALTH_JSON" "$ERRORS" <<'PY'
import json, sys
body = json.loads(sys.argv[1])
body["verify_errors"] = int(sys.argv[2])
print(json.dumps(body))
PY
  exit "$ERRORS"
fi

$QUIET || echo
if (( ERRORS > 0 )); then
  $QUIET || echo "TV verify: $ERRORS check(s) failed"
  mango_log verify_tv status=fail "errors=$ERRORS"
  exit 1
fi

$QUIET || echo "TV verify: ok"
mango_log verify_tv status=ok
exit 0
