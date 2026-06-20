#!/usr/bin/env bash
# Phase N3a gate - browse pick -> POST /play within couch budget.

set -euo pipefail

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init

TMP_DIR="${TMPDIR:-/tmp}/mango-n3a-gate"
mkdir -p "$TMP_DIR"

MAX_TOTAL_MS="${MANGO_N3A_MAX_TOTAL_MS:-15000}"
MAX_ATTEMPTS="${MANGO_N3A_MAX_ATTEMPTS:-5}"
SHAWSHANK_ID="${MANGO_N3A_SHAWSHANK_ID:-tt0111161}"

trap gate_mpv_stop EXIT

gate_header "mango N3a play gate"

curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
  && gate_pass "catalog /health" || { gate_fail "catalog /health"; exit 1; }

python3 - config/catalog-filters.example.json "$MAX_TOTAL_MS" <<'PY' \
  && gate_pass "repo couch filters" || gate_fail "repo couch filters"
import json
import sys
path, max_total = sys.argv[1], int(sys.argv[2])
data = json.load(open(path, encoding="utf-8"))
assert data.get("strict_unknown_cache") is True, "strict_unknown_cache must be true"
assert int(data.get("auto_play_wall_ms") or 0) <= max_total, "auto_play_wall_ms too high"
assert int(data.get("auto_play_probe_ms") or 0) <= 4000, "auto_play_probe_ms too high"
tiers = data.get("auto_play_tiers") or []
assert tiers, "auto_play_tiers missing"
for tier in tiers:
    addons = [str(item).lower() for item in tier.get("addons", [])]
    assert any("aiostreams" in item for item in addons), "autoplay tier must use AIOStreams"
    assert not any(item == "torrentio" for item in addons), "standalone Torrentio is not autoplay"
PY

pick_rail_item() {
  local rail_id="$1" out_json="$2"
  curl -sf --max-time 30 "http://127.0.0.1:3020/rails/${rail_id}/items" >"$out_json" \
    || { gate_fail "GET /rails/${rail_id}/items"; return 1; }
  python3 - "$out_json" "$rail_id" "$SHAWSHANK_ID" <<'PY'
import json
import random
import sys
path, rail_id, excluded_id = sys.argv[1:4]
items = [
    item for item in (json.load(open(path, encoding="utf-8")).get("items") or [])
    if item.get("id") and item.get("id") != excluded_id
]
if not items:
    raise SystemExit(f"{rail_id}: no non-Shawshank items")
item = random.SystemRandom().choice(items)
title = (item.get("title") or item.get("id") or "").replace("\t", " ")
print(f"{item.get('type') or 'movie'}\t{item.get('id')}\t{title}")
PY
}

play_pick() {
  local label="$1" rail_id="$2" item_type="$3" item_id="$4" title="$5"
  local severity="${6:-attempt}"
  local out="$TMP_DIR/play-${rail_id}-${item_id}.json"
  echo "pick: ${label} rail=${rail_id} type=${item_type} id=${item_id} title=${title}"
  gate_post_play "$label" "$item_type" "$item_id" "$out" "$MAX_TOTAL_MS" "$MAX_ATTEMPTS" "$rail_id" "$severity"
}

run_rail_pick() {
  local label="$1" rail_id="$2"
  local items_json="$TMP_DIR/${rail_id}.json"
  local max_tries="${MANGO_N3A_PICK_RETRIES:-3}"
  local attempt=1
  while (( attempt <= max_tries )); do
    local picked item_type item_id title
    picked="$(pick_rail_item "$rail_id" "$items_json")" || return 1
    IFS=$'\t' read -r item_type item_id title <<<"$picked"
    [[ -n "$item_id" ]] || { gate_fail "${label} empty pick"; return 1; }
    if play_pick "${label} try${attempt}" "$rail_id" "$item_type" "$item_id" "$title" "attempt"; then
      python3 - "$TMP_DIR/play-${rail_id}-${item_id}.json" "${label}" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
print(f"metric: {sys.argv[2]} total_ms={data.get('total_ms')} attempts={data.get('attempts')} ttff_ms={data.get('ttff_ms')}")
PY
      gate_mpv_stop
      return 0
    fi
    gate_mpv_stop
    attempt=$((attempt + 1))
  done
  gate_fail "${label} failed after ${max_tries} browse picks"
  return 1
}

run_rail_pick "browse-movie" "movies-india-trending" || true
run_rail_pick "browse-series" "series-india-picks" || true

SHAW_JSON="$TMP_DIR/play-shawshank.json"
if gate_post_play "shawshank" "movie" "$SHAWSHANK_ID" "$SHAW_JSON" "" "$MAX_ATTEMPTS" "" "warn"; then
  if ! python3 - "$SHAW_JSON" "$MAX_TOTAL_MS" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
total = int(data.get("total_ms") or 0)
limit = int(sys.argv[2])
if total > limit:
    print(f"shawshank total_ms={total} > {limit}")
    raise SystemExit(1)
else:
    print(f"metric: shawshank total_ms={total} attempts={data.get('attempts')} ttff_ms={data.get('ttff_ms')}")
PY
  then
    gate_warn "shawshank total_ms > ${MAX_TOTAL_MS}"
  fi
else
  :
fi
gate_mpv_stop

bash scripts/phase-n2/gate-n2-browse.sh || gate_fail "N2 browse regression"
bash scripts/phase-n0/gate-n0.sh || gate_fail "N0 regression"

gate_finish "N3a gate" || exit 1
