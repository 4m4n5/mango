#!/usr/bin/env bash
# Narrow self-healing pass for couch reliability. Safe for watchdog timer use.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
LOCK_FILE="${CACHE_DIR}/mango-health-repair.lock"
PLAYABILITY_LOCK_FILE="${CACHE_DIR}/playability-maintenance.lock"
QUIET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quiet) QUIET=1; shift ;;
    -h|--help)
      echo "usage: $0 [--quiet]"
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

cd "$REPO_DIR"
mkdir -p "$CACHE_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  [[ "$QUIET" == "1" ]] || echo "health-repair: already running"
  exit 0
fi
cleanup_lock() {
  flock -u 9 2>/dev/null || true
  rm -f "$LOCK_FILE"
}
trap cleanup_lock EXIT

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

# shellcheck source=lib/mango-log.sh
source "$REPO_DIR/scripts/lib/mango-log.sh" 2>/dev/null || mango_log() { :; }
# shellcheck source=lib/catalog-service-stack.sh
source "$REPO_DIR/scripts/lib/catalog-service-stack.sh"

say() {
  [[ "$QUIET" == "1" ]] || echo "$*"
}

repair_count=0
fail_count=0

repair_note() {
  repair_count=$((repair_count + 1))
  mango_log health_repair action="$1" reason="${2:-}"
  say "health-repair: $1 ${2:-}"
}

fail_note() {
  fail_count=$((fail_count + 1))
  mango_log health_repair status=fail check="$1" reason="${2:-}"
  say "health-repair: FAIL $1 ${2:-}" >&2
}

kill_safe_strays() {
  pkill -f 'playability-indexer' 2>/dev/null || true
  pkill -f 'tsx.*m3-play/playability' 2>/dev/null || true
  pkill -f 'gate-m3-verified-rails' 2>/dev/null || true
  pkill -f 'gate-m3-verified' 2>/dev/null || true
  pkill -f 'curl.*127.0.0.1:3020/play' 2>/dev/null || true
  pkill -f 'node --input-type=module -e.*CatalogCore' 2>/dev/null || true
  pkill -f '[b]luetoothctl connect E4:17:D8:EB:00:44' 2>/dev/null || true
}

playability_maintenance_active() {
  pgrep -f '[p]layability-maintenance.sh|[n]ightly-library-refresh.sh|[o]vernight-playability-grow.sh' >/dev/null 2>&1 \
    && return 0
  [[ -f "$PLAYABILITY_LOCK_FILE" ]] || return 1
  (
    exec 8>"$PLAYABILITY_LOCK_FILE"
    ! flock -n 8
  )
}

catalog_expected() {
  [[ "${MANGO_CATALOG:-1}" == "1" ]] && return 0
  systemctl --user is-enabled mango-catalog.service >/dev/null 2>&1
}

catalog_ready() {
  local body
  body="$(curl -sf --max-time 4 "$(catalog_service_url)/health" 2>/dev/null || true)"
  [[ -n "$body" ]] || return 1
  python3 - "$body" <<'PY'
import json
import sys
try:
    data = json.loads(sys.argv[1])
except Exception:
    raise SystemExit(1)
ok = bool(data.get("ok")) and data.get("core") == "ready" and bool(data.get("rails_ready"))
if "live_ready" in data:
    ok = ok and bool(data.get("live_ready"))
live = data.get("live")
if isinstance(live, dict) and "ready" in live:
    ok = ok and bool(live.get("ready"))
raise SystemExit(0 if ok else 1)
PY
}

repair_catalog() {
  repair_note restart_catalog "$1"
  if systemctl --user is-enabled mango-catalog.service >/dev/null 2>&1; then
    systemctl --user restart mango-catalog.service || true
  else
    MANGO_CATALOG=1 start_catalog_service_only || true
  fi
  for _ in $(seq 1 60); do
    catalog_ready && return 0
    sleep 1
  done
  return 1
}

launcher_browser_running() {
  pgrep -f "chromium.*mango-launcher.*127.0.0.1:${MANGO_LAUNCHER_PORT:-3000}/|firefox.*127.0.0.1:${MANGO_LAUNCHER_PORT:-3000}/" >/dev/null 2>&1
}

launcher_health_ok() {
  local body
  body="$(curl -sf --max-time 4 "http://127.0.0.1:${MANGO_LAUNCHER_PORT:-3000}/api/health" 2>/dev/null || true)"
  [[ -n "$body" ]] || return 1
  python3 - "$body" <<'PY'
import json
import sys
try:
    data = json.loads(sys.argv[1])
except Exception:
    raise SystemExit(1)
checks = data.get("checks") or {}
ok = (
    bool(checks.get("launcher_dist"))
    and bool(checks.get("launcher_browser"))
    and checks.get("openbox") == "active"
)
raise SystemExit(0 if ok else 1)
PY
}

repair_ui() {
  repair_note restart_launcher "$1"
  if systemctl --user is-enabled mango-ui-server.service >/dev/null 2>&1; then
    systemctl --user restart mango-ui-server.service || true
  fi
  if systemctl --user is-enabled mango-launcher-chromium.service >/dev/null 2>&1; then
    systemctl --user restart mango-launcher-chromium.service || true
  else
    bash scripts/m1-foundation/ui/start-mango-ui.sh >/dev/null 2>&1 || true
  fi
  for _ in $(seq 1 30); do
    launcher_health_ok && launcher_browser_running && return 0
    sleep 1
  done
  return 1
}

bash scripts/lib/stale-flock-cleanup.sh >/dev/null 2>&1 || true

if playability_maintenance_active; then
  mango_log health_repair status=skipped reason=playability_maintenance_active
  say "health-repair: skipped playability maintenance active"
  exit 0
fi

kill_safe_strays

if ! bash scripts/m1-foundation/pad/pad-health.sh --quiet; then
  repair_note restart_pad "pad_health"
  MANGO_PAD_REPAIR_WAIT_STEPS="${MANGO_PAD_REPAIR_WAIT_STEPS:-24}" \
    bash scripts/m1-foundation/pad/pad-health.sh --quiet --repair \
    || fail_note pad "repair_failed"
fi

if catalog_expected; then
  catalog_ready || repair_catalog "catalog_health" || fail_note catalog "repair_failed"
fi

if ! launcher_health_ok || ! launcher_browser_running; then
  repair_ui "ui_health" || fail_note launcher "repair_failed"
fi

if (( fail_count > 0 )); then
  mango_log health_repair status=fail repairs="$repair_count" failures="$fail_count"
  exit 1
fi

mango_log health_repair status=ok repairs="$repair_count"
say "health-repair: ok repairs=${repair_count}"
exit 0
