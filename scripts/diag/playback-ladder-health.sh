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
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

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
jq '{
  resolve_ms,
  cached,
  stream_count: (.streams | length),
  streams: [.streams[] | {
    source,
    indexer,
    debrid_service,
    cache_status,
    resolution,
    encode,
    ladder_step,
    unverified
  }]
}' "$STREAMS_JSON"

echo "resolver health (fixed categories only)"
jq '{
  configured_stream_providers,
  resolver: {
    provider_fanout_requests: .resolver.provider_fanout_requests,
    provider_fanout_addons: .resolver.provider_fanout_addons,
    provider_fanout_total_ms: .resolver.provider_fanout_total_ms,
    providers: .resolver.providers,
    last_user_contributions: .resolver.last_contributions.user
  }
}' "$HEALTH_JSON"
