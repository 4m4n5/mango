#!/usr/bin/env bash
# Credential-safe resolver and playback-ladder evidence from a running catalog service.

set -euo pipefail

TYPE="${1:-}"
ID="${2:-}"
BASE_URL="${MANGO_CATALOG_URL:-http://127.0.0.1:3020}"

if [[ "$TYPE" != "movie" && "$TYPE" != "series" ]]; then
  echo "usage: $0 <movie|series> <stremio-id>" >&2
  exit 2
fi
if [[ -z "$ID" || ! "$ID" =~ ^[A-Za-z0-9:_-]+$ ]]; then
  echo "invalid or missing stream id" >&2
  exit 2
fi
command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }

STREAMS_JSON="$(mktemp)"
HEALTH_JSON="$(mktemp)"
cleanup() {
  rm -f "$STREAMS_JSON" "$HEALTH_JSON"
}
trap cleanup EXIT

curl -fsS --max-time 40 \
  "$BASE_URL/stream/$TYPE/$ID?strict_unknown_cache=false" >"$STREAMS_JSON"
curl -fsS --max-time 5 "$BASE_URL/health" >"$HEALTH_JSON"

echo "stream ladder (URL-free)"
python3 - "$STREAMS_JSON" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
streams = []
for s in d.get("streams") or []:
    streams.append({
        "source": s.get("source"),
        "indexer": s.get("indexer"),
        "debrid_service": s.get("debrid_service"),
        "cache_status": s.get("cache_status"),
        "resolution": s.get("resolution"),
        "encode": s.get("encode"),
        "ladder_step": s.get("ladder_step"),
        "unverified": s.get("unverified"),
    })
print(json.dumps({
    "resolve_ms": d.get("resolve_ms"),
    "cached": d.get("cached"),
    "stream_count": len(d.get("streams") or []),
    "streams": streams,
}, indent=2))
PY

echo "resolver health (fixed categories only)"
python3 - "$HEALTH_JSON" <<'PY'
import json, sys
h = json.load(open(sys.argv[1], encoding="utf-8"))
resolver = h.get("resolver") or {}
contrib = (resolver.get("last_contributions") or {}).get("user")
print(json.dumps({
    "configured_stream_providers": h.get("configured_stream_providers"),
    "resolver": {
        "provider_fanout_requests": resolver.get("provider_fanout_requests"),
        "provider_fanout_addons": resolver.get("provider_fanout_addons"),
        "provider_fanout_total_ms": resolver.get("provider_fanout_total_ms"),
        "stream_resolve_retries": resolver.get("stream_resolve_retries"),
        "stream_resolve_retry_recoveries": resolver.get("stream_resolve_retry_recoveries"),
        "stream_resolve_retry_exhaustions": resolver.get("stream_resolve_retry_exhaustions"),
        "providers": resolver.get("providers"),
        "last_user_contributions": contrib,
    },
}, indent=2))
PY
