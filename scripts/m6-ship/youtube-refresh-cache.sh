#!/usr/bin/env bash
# Refresh Mango's native YouTube metadata/cache through catalog-service.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
REASON="${MANGO_YOUTUBE_REFRESH_REASON:-scheduled}"
TIMEOUT_SEC="${MANGO_YOUTUBE_REFRESH_TIMEOUT_SEC:-600}"

usage() {
  cat <<EOF
usage: $0 [--reason <reason>] [--timeout-sec <seconds>]

Env:
  MANGO_CATALOG_URL                 override catalog-service URL
  MANGO_CATALOG_PORT                default 3020 when URL is not set
  MANGO_YOUTUBE_REFRESH_CACHE=0     skip and exit successfully
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason) REASON="${2:-}"; shift 2 ;;
    --timeout-sec) TIMEOUT_SEC="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ "${MANGO_YOUTUBE_REFRESH_CACHE:-1}" != "1" ]]; then
  echo "youtube refresh: skipped (MANGO_YOUTUBE_REFRESH_CACHE=${MANGO_YOUTUBE_REFRESH_CACHE:-})"
  exit 0
fi

cd "$REPO_DIR"

# shellcheck source=../lib/catalog-service-stack.sh
source "$REPO_DIR/scripts/lib/catalog-service-stack.sh"

CATALOG="${MANGO_CATALOG_URL:-$(catalog_service_url)}"

if ! curl -sf --max-time 5 "$CATALOG/health" >/dev/null 2>&1; then
  if [[ -n "${MANGO_CATALOG_URL:-}" ]]; then
    echo "youtube refresh: catalog-service unavailable at $CATALOG" >&2
    exit 1
  fi
  echo "youtube refresh: catalog-service not healthy; starting it"
  MANGO_CATALOG=1 start_catalog_service_only
fi

body="$(python3 - "$REASON" <<'PY'
import json
import sys

reason = sys.argv[1].strip() or "scheduled"
print(json.dumps({"reason": reason}, separators=(",", ":")))
PY
)"

out="$(mktemp)"
trap 'rm -f "$out"' EXIT

if ! curl -sS --fail --max-time "$TIMEOUT_SEC" \
  -H 'content-type: application/json' \
  -d "$body" \
  "$CATALOG/youtube/refresh" >"$out"; then
  echo "youtube refresh: POST /youtube/refresh failed" >&2
  exit 1
fi

python3 - "$out" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)

refresh = payload.get("refresh") or {}
if payload.get("ok") is not True:
    error = payload.get("error") or refresh.get("last_error") or "unknown error"
    print(f"youtube refresh: failed: {error}", file=sys.stderr)
    raise SystemExit(1)

last_success = refresh.get("last_success_at") or "unknown"
quota_used = refresh.get("quota_used_today")
quota_reset = refresh.get("quota_reset_day")
quota_text = f" quota_used_today={quota_used}" if quota_used is not None else ""
if quota_text and quota_reset:
    quota_text = f"{quota_text} reset_day={quota_reset}"
phases = payload.get("phases") or refresh.get("phase_results") or []
failed = [phase for phase in phases if phase.get("ok") is not True]
phase_text = ""
if phases:
    phase_text = " phases=" + ",".join(
        f"{phase.get('phase')}:{'ok' if phase.get('ok') is True else 'fail'}"
        for phase in phases
    )
print(f"youtube refresh: complete last_success_at={last_success}{quota_text}{phase_text}")
for phase in failed:
    print(
        f"youtube refresh: warning phase {phase.get('phase')} failed: {phase.get('error') or 'unknown'}",
        file=sys.stderr,
    )
PY
