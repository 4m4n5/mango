#!/usr/bin/env bash
# N3c gate — play served rail items (sampled unless MANGO_GATE_FULL=1).

set -euo pipefail

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init

TMP_DIR="${TMPDIR:-/tmp}/mango-n3c-gate"
mkdir -p "$TMP_DIR"

if [[ "${MANGO_GATE_FULL:-0}" == "1" ]]; then
  MAX_PER_RAIL=0
else
  MAX_PER_RAIL="${MANGO_N3C_GATE_MAX_PER_RAIL:-2}"
fi

trap gate_mpv_stop EXIT

gate_header "mango N3c verified rails gate"
[[ "$MAX_PER_RAIL" -gt 0 ]] && echo "sample: ${MAX_PER_RAIL} item(s)/rail (set MANGO_GATE_FULL=1 for all)" && echo

CHECKED=0
PASSED=0

curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
  && gate_pass "catalog /health" || { gate_fail "catalog /health"; exit 1; }

RAILS_JSON="$TMP_DIR/rails.json"
curl -sf --max-time 10 http://127.0.0.1:3020/rails >"$RAILS_JSON" \
  || { gate_fail "GET /rails"; exit 1; }

while IFS= read -r rail_id; do
  [[ -n "$rail_id" ]] || continue
  ITEMS_JSON="$TMP_DIR/rail-${rail_id}.json"
  curl -sf --max-time 30 "http://127.0.0.1:3020/rails/${rail_id}/items" >"$ITEMS_JSON" \
    || { gate_fail "GET /rails/${rail_id}/items"; continue; }

  item_count="$(python3 - "$ITEMS_JSON" <<'PY'
import json, sys
print(len(json.load(open(sys.argv[1], encoding="utf-8")).get("items", [])))
PY
)"
  if [[ "$item_count" == "0" ]]; then
    if [[ "${MANGO_N3C_REQUIRE_MIN_DISPLAY:-0}" == "1" ]]; then
      gate_fail "$rail_id 0 items"
    else
      gate_pass "$rail_id 0/0 (bootstrap)"
    fi
    continue
  fi

  rail_checked=0
  rail_passed=0
  while IFS=$'\t' read -r item_type item_id _title; do
    [[ -n "$item_id" ]] || continue
    CHECKED=$((CHECKED + 1))
    rail_checked=$((rail_checked + 1))
    OUT_JSON="$TMP_DIR/play-${rail_id}-${item_id}.json"
    if gate_post_play "$rail_id" "$item_type" "$item_id" "$OUT_JSON"; then
      PASSED=$((PASSED + 1))
      rail_passed=$((rail_passed + 1))
    fi
    gate_mpv_stop
  done < <(python3 - "$ITEMS_JSON" "$MAX_PER_RAIL" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
limit = int(sys.argv[2])
items = data.get("items") or []
if limit > 0:
    items = items[:limit]
for item in items:
    item_id = item.get("id")
    if not item_id:
        continue
    item_type = item.get("type") or "movie"
    title = (item.get("title") or item_id).replace("\t", " ")
    print(f"{item_type}\t{item_id}\t{title}")
PY
)
  gate_pass "$rail_id ${rail_passed}/${rail_checked}"
done < <(python3 - "$RAILS_JSON" <<'PY'
import json, sys
for rail in json.load(open(sys.argv[1], encoding="utf-8")).get("rails", []):
    if rail.get("id"):
        print(rail["id"])
PY
)

echo
if (( ERRORS > 0 )); then
  echo "N3c GATE FAIL: ${PASSED}/${CHECKED} plays, ${ERRORS} error(s)" >&2
  exit 1
fi
echo "N3c GATE PASS: ${PASSED}/${CHECKED} plays"
exit 0
