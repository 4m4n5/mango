#!/usr/bin/env bash
# N3b gate — detail stream picker backend (display_label enrichment).
# Usage: bash scripts/m3-play/detail/gate-m3-detail.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$REPO_DIR"

CATALOG="${MANGO_CATALOG_UPSTREAM:-http://127.0.0.1:3020}"
FIXTURES="${MANGO_STREAM_GATE_FIXTURES:-$REPO_DIR/config/stream-gate-fixtures.json}"
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

IFS=$'\t' read -r SERIES_TYPE SERIES_ID SERIES_LABEL < <(python3 - "$FIXTURES" <<'PY'
import json
import pathlib
import sys

fallback = ("series", "tt0903747:1:1", "Breaking Bad")
path = pathlib.Path(sys.argv[1])
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    print("\t".join(fallback))
    raise SystemExit(0)

for fixture in data.get("fixtures") or []:
    if fixture.get("type") == "series" and fixture.get("tier", "required") == "required":
        print("\t".join([
            str(fixture.get("type") or fallback[0]),
            str(fixture.get("id") or fallback[1]),
            str(fixture.get("label") or fallback[2]),
        ]))
        break
else:
    print("\t".join(fallback))
PY
)

SERIES_JSON="$(curl -sf --max-time 45 "$CATALOG/stream/${SERIES_TYPE}/${SERIES_ID}" || true)"
if [[ -n "$SERIES_JSON" ]] && echo "$SERIES_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
streams = d.get("streams") or []
assert len(streams) >= 1
' 2>/dev/null; then
  ok "series-episode-streams (${SERIES_LABEL})"
else
  bad "series-episode-streams (${SERIES_LABEL})"
fi

echo
echo "SUMMARY pass=$PASS fail=$FAIL"
[[ "$FAIL" -eq 0 ]]
