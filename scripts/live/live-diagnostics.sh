#!/usr/bin/env bash
# Operator-only Live rail diagnostics from catalog-service health.
# Does not probe /stream, reshuffle, or rebuild Live rails.

set -euo pipefail

CATALOG_URL="${MANGO_CATALOG_URL:-http://127.0.0.1:3020}"
TIMEOUT="${MANGO_LIVE_DIAG_TIMEOUT:-8}"
JSON=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=true; shift ;;
    *) echo "usage: $0 [--json]" >&2; exit 2 ;;
  esac
done

payload="$(curl -sf --max-time "$TIMEOUT" "${CATALOG_URL}/health")" || {
  echo "live-diagnostics: catalog unreachable at $CATALOG_URL" >&2
  exit 1
}

python3 - "$payload" "$JSON" <<'PY'
import json
import sys

health = json.loads(sys.argv[1])
json_only = sys.argv[2] == "true"
live = health.get("live") or {}
cache = live.get("cache") or {}

if json_only:
    print(json.dumps(live, indent=2, sort_keys=True))
    raise SystemExit(0)

rail_counts = cache.get("rail_counts") or {}
rail_summary = ", ".join(f"{rid}={count}" for rid, count in sorted(rail_counts.items())) or "none"
print(f"live.ready={live.get('ready')}")
print(f"live.config_error={live.get('config_error')}")
print(f"live.sources={len(live.get('sources') or [])}")
print(f"live.cache.path={cache.get('path')}")
print(f"live.cache.present={cache.get('present')} non_empty={cache.get('non_empty')} fresh={cache.get('fresh')}")
print(f"live.cache.age_sec={cache.get('age_sec')} expires_in_sec={cache.get('expires_in_sec')}")
print(f"live.cache.rail_counts={rail_summary}")
print(f"live.stale_fallback_available={live.get('stale_fallback_available')}")
print(f"live.last_rebuild_error={live.get('last_rebuild_error')}")
PY
