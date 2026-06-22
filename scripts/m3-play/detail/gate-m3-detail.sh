#!/usr/bin/env bash
# N3b gate — detail stream picker backend (display_label enrichment).
# Usage: bash scripts/m3-play/detail/gate-m3-detail.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

CATALOG="${MANGO_CATALOG_UPSTREAM:-http://127.0.0.1:3020}"
PASS=0
FAIL=0

ok() { echo "  PASS: $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

echo "=== N3b detail gate $(date -Iseconds) ==="
echo "catalog: $CATALOG"
echo

MOVIE_JSON="$(curl -sf --max-time 45 "$CATALOG/stream/movie/tt0111161" || true)"
if [[ -n "$MOVIE_JSON" ]] && echo "$MOVIE_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
streams = d.get("streams") or []
assert len(streams) >= 1
label = streams[0].get("display_label") or ""
assert label.strip() != ""
' 2>/dev/null; then
  ok "movie-stream-labels"
else
  bad "movie-stream-labels"
fi

SERIES_JSON="$(curl -sf --max-time 45 "$CATALOG/stream/series/tt12004706:1:1" || true)"
if [[ -n "$SERIES_JSON" ]] && echo "$SERIES_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
streams = d.get("streams") or []
assert len(streams) >= 1
' 2>/dev/null; then
  ok "series-episode-streams"
else
  bad "series-episode-streams"
fi

echo
echo "SUMMARY pass=$PASS fail=$FAIL"
[[ "$FAIL" -eq 0 ]]
