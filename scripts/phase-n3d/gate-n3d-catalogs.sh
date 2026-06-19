#!/usr/bin/env bash
# N3d catalog gate — mdblist rails come from AIOLists and return items.

set -euo pipefail

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init

TMP_DIR="${TMPDIR:-/tmp}/mango-n3d-gate"
mkdir -p "$TMP_DIR"
RAILS_JSON="$TMP_DIR/rails.json"

MDBLIST_RAILS=(
  movies-india-trending
  movies-classics
  movies-comedy
  movies-quick-watches
  movies-documentaries
  series-india-picks
  series-classics
  series-comedy
  series-miniseries
  series-documentaries
)

INDIA_RAILS=(
  movies-india-trending
  series-india-picks
)

gate_header "mango N3d catalog gate"

curl -sf --max-time 5 http://127.0.0.1:3036/manifest.json >/dev/null \
  || curl -sf --max-time 5 http://127.0.0.1:3036/ >/dev/null \
  && gate_pass "AIOLists reachable :3036" \
  || gate_fail "AIOLists down at :3036"

curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
  && gate_pass "catalog /health" \
  || gate_fail "catalog-service down at :3020"

if curl -sf --max-time 10 http://127.0.0.1:3020/rails >"$RAILS_JSON"; then
  gate_pass "GET /rails"
else
  gate_fail "GET /rails"
fi

if [[ -s "$RAILS_JSON" ]]; then
  if python3 - "$RAILS_JSON" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
bad = []
for rail in data.get("rails", []):
    for source in rail.get("sources") or []:
        addon = str(source.get("addon") or "")
        catalog = str(source.get("catalog") or "")
        if catalog.startswith("mdblist.") and addon != "AIOLists":
            bad.append(f"{rail.get('id')}:{catalog}:{addon}")
        if "ElfHosted" in addon:
            bad.append(f"{rail.get('id')}:{catalog}:{addon}")
if bad:
    raise SystemExit("bad sources: " + ", ".join(bad))
PY
  then
    gate_pass "mdblist sources use AIOLists"
  else
    gate_fail "mdblist sources use AIOLists"
  fi
fi

check_rail_items() {
  local rail_id="$1" label="$2" items_json item_count
  items_json="$TMP_DIR/rail-${rail_id}.json"
  if ! curl -sf --max-time 30 "http://127.0.0.1:3020/rails/${rail_id}/items" >"$items_json"; then
    gate_fail "$label $rail_id GET items"
    return
  fi
  item_count="$(python3 - "$items_json" <<'PY'
import json
import sys
print(len((json.load(open(sys.argv[1], encoding="utf-8")).get("items") or [])))
PY
)"
  if [[ "${item_count:-0}" -ge 1 ]]; then
    gate_pass "$label $rail_id items=${item_count}"
  else
    gate_fail "$label $rail_id items=0"
  fi
}

for rail in "${MDBLIST_RAILS[@]}"; do
  check_rail_items "$rail" "mdblist"
done

for rail in "${INDIA_RAILS[@]}"; do
  check_rail_items "$rail" "india"
done

gate_finish "N3d catalog gate"
