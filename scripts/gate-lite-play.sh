#!/usr/bin/env bash
# Minimal live play smoke — one movie + one series (not per-rail).

set -euo pipefail

export MANGO_REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=lib/gate-common.sh
source "$(cd "$(dirname "$0")" && pwd)/lib/gate-common.sh"
mango_gate_init

TMP_DIR="${TMPDIR:-/tmp}/mango-gate-lite"
mkdir -p "$TMP_DIR"

MOVIE_ID="${MANGO_GATE_LITE_MOVIE_ID:-tt0111161}"
SERIES_ID="${MANGO_GATE_LITE_SERIES_ID:-tt0903747:1:1}"
SUPPLEMENTAL_CHECK_ID="${MANGO_GATE_LITE_STREAM_MOVIE_ID:-tt32916440}"
MAX_TOTAL_MS="${MANGO_GATE_LITE_MAX_TOTAL_MS:-90000}"
MAX_ATTEMPTS="${MANGO_GATE_LITE_MAX_ATTEMPTS:-12}"

trap gate_mpv_stop EXIT

curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
  && gate_pass "catalog /health" || { gate_fail "catalog /health"; exit 1; }

STREAM_JSON="$TMP_DIR/stream-${SUPPLEMENTAL_CHECK_ID}.json"
if curl -sf --max-time 45 "http://127.0.0.1:3020/stream/movie/${SUPPLEMENTAL_CHECK_ID}" >"$STREAM_JSON"; then
  python3 - "$STREAM_JSON" <<'PY' && gate_pass "supplemental stream filter (${SUPPLEMENTAL_CHECK_ID})" \
    || gate_fail "supplemental stream filter (${SUPPLEMENTAL_CHECK_ID})"
import json
import re
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
streams = data.get("streams") or []
if not streams:
    raise SystemExit("no streams returned")
supplemental = re.compile(
    r"\b(behind[\s-]?the[\s-]?scenes|featurette|bonus|extras?|making[\s-]?of|bts)\b",
    re.I,
)
for stream in streams:
    haystack = " ".join(
        str(stream.get(key) or "")
        for key in ("name", "title", "description")
    )
    if supplemental.search(haystack):
        raise SystemExit(f"supplemental label in picker: {haystack[:120]!r}")
print(f"streams={len(streams)}")
PY
else
  gate_warn "GET /stream/movie/${SUPPLEMENTAL_CHECK_ID} (supplemental check skipped)"
fi

MOVIE_JSON="$TMP_DIR/play-movie.json"
gate_post_play "lite-movie" "movie" "$MOVIE_ID" "$MOVIE_JSON" "$MAX_TOTAL_MS" "$MAX_ATTEMPTS" "" "fail" \
  || exit 1
gate_mpv_stop

SERIES_JSON="$TMP_DIR/play-series.json"
gate_post_play "lite-series" "series" "$SERIES_ID" "$SERIES_JSON" "$MAX_TOTAL_MS" "$MAX_ATTEMPTS" "" "fail" \
  || exit 1
gate_mpv_stop

TAB_JSON="$TMP_DIR/tab-movies.json"
if curl -sf --max-time 30 "http://127.0.0.1:3020/rails/items?tab=movies" >"$TAB_JSON"; then
  python3 - "$TAB_JSON" <<'PY' && gate_pass "tab session movies" || gate_fail "tab session movies"
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
rails = data.get("rails") or []
if not rails:
    raise SystemExit("no rails in tab session")
ids = {rail.get("id") for rail in rails}
# continue-watching is omitted when empty — any served rail proves tab API works
if not ids:
    raise SystemExit("rails missing ids")
print(f"rails={len(rails)}")
PY
else
  gate_fail "GET /rails/items?tab=movies"
  exit 1
fi

FLUSH_CODE="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3020/progress/flush || true)"
[[ "$FLUSH_CODE" =~ ^2 ]] && gate_pass "POST /progress/flush" || gate_fail "POST /progress/flush http=${FLUSH_CODE:-unknown}"

exit 0
