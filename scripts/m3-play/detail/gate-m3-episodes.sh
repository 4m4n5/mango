#!/usr/bin/env bash
# N3e gate — series episode API + structure (no UI).
# Usage: bash scripts/m3-play/detail/gate-m3-episodes.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$REPO_DIR"

CATALOG="${MANGO_CATALOG_UPSTREAM:-http://127.0.0.1:3020}"
PASS=0
FAIL=0

ok() { echo "  PASS: $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

echo "=== N3e episodes gate $(date -Iseconds) ==="
echo "catalog: $CATALOG"
echo

EP_JSON="$(curl -sf --max-time 30 "$CATALOG/series/tt12004706/episodes" || true)"
if [[ -n "$EP_JSON" ]] && echo "$EP_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d.get("series_id") == "tt12004706"
assert d.get("episode_count", 0) >= 4
seasons = d.get("seasons") or []
assert len(seasons) >= 1
eps = seasons[0].get("episodes") or []
assert len(eps) >= 1
row = eps[0]
assert "playable" in row
assert row.get("season") == 1
' 2>/dev/null; then
  ok "panchayat-episodes"
else
  bad "panchayat-episodes"
fi

HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$CATALOG/series/tt12004706:1:1/episodes" || echo 000)"
if [[ "$HTTP_CODE" == "400" ]]; then
  ok "reject-episode-id"
else
  bad "reject-episode-id (http=$HTTP_CODE)"
fi

NEXT_JSON="$(curl -sf --max-time 10 "$CATALOG/play/next-prompt" || true)"
if [[ -n "$NEXT_JSON" ]] && echo "$NEXT_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "show" in d' 2>/dev/null; then
  ok "next-prompt-endpoint"
else
  bad "next-prompt-endpoint"
fi

echo
echo "SUMMARY pass=$PASS fail=$FAIL"
[[ "$FAIL" -eq 0 ]]
