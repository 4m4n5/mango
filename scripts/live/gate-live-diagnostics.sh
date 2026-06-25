#!/usr/bin/env bash
# Health-only Live diagnostics gate. Avoids stream probes and Live reshuffles.

set -euo pipefail

CATALOG_URL="${MANGO_CATALOG_URL:-http://127.0.0.1:3020}"
TIMEOUT="${MANGO_LIVE_DIAG_TIMEOUT:-8}"

payload="$(curl -sf --max-time "$TIMEOUT" "${CATALOG_URL}/health")" || {
  echo "FAIL: catalog unreachable at $CATALOG_URL" >&2
  exit 1
}

python3 - "$payload" <<'PY'
import json
import os
import sys

health = json.loads(sys.argv[1])
live = health.get("live")
failures = []

if not isinstance(live, dict):
    failures.append("/health missing live diagnostics")
else:
    cache = live.get("cache")
    sources = live.get("sources")
    if not isinstance(live.get("ready"), bool):
        failures.append("live.ready must be a boolean")
    if not isinstance(sources, list):
        failures.append("live.sources must be a list")
    if not isinstance(cache, dict):
        failures.append("live.cache must be an object")
    else:
        if not cache.get("path"):
            failures.append("live.cache.path missing")
        if not isinstance(cache.get("rail_counts"), dict):
            failures.append("live.cache.rail_counts must be an object")
        for key in ("present", "non_empty", "fresh"):
            if not isinstance(cache.get(key), bool):
                failures.append(f"live.cache.{key} must be a boolean")
    if not isinstance(live.get("stale_fallback_available"), bool):
        failures.append("live.stale_fallback_available must be a boolean")
    if os.environ.get("MANGO_LIVE_REQUIRE_STALE_FALLBACK") == "1" and not live.get("stale_fallback_available"):
        failures.append("required stale Live fallback is not available")

if failures:
    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    raise SystemExit(1)

cache = live.get("cache") or {}
rail_counts = cache.get("rail_counts") or {}
print(
    "PASS: live diagnostics "
    f"ready={live.get('ready')} "
    f"cache_non_empty={cache.get('non_empty')} "
    f"stale_fallback={live.get('stale_fallback_available')} "
    f"rails={len(rail_counts)}"
)
PY
