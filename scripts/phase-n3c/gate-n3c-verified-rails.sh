#!/usr/bin/env bash
# Phase N3c verified-rails gate — probe/play every item currently served by rails.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

TMP_DIR="${TMPDIR:-/tmp}/mango-n3c-gate"
mkdir -p "$TMP_DIR"

ERRORS=0
CHECKED=0
PASSED=0

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }

cleanup() {
  bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true
}
trap cleanup EXIT

json_get_rails() {
  python3 - "$1" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
for rail in data.get("rails", []):
    rail_id = rail.get("id")
    if rail_id:
        print(rail_id)
PY
}

json_get_items() {
  python3 - "$1" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
for item in data.get("items", []):
    item_id = item.get("id")
    item_type = item.get("type") or "movie"
    title = (item.get("title") or item_id or "").replace("\t", " ").replace("\n", " ")
    if item_id:
        print(f"{item_type}\t{item_id}\t{title}")
PY
}

check_play_json() {
  python3 - "$1" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
if data.get("ok") is not True:
    raise SystemExit("ok is not true")
ttff = int(data.get("ttff_ms") or 0)
total = int(data.get("total_ms") or 0)
attempts = int(data.get("attempts") or 0)
if ttff <= 0 or total <= 0 or attempts < 1:
    raise SystemExit(f"bad playback metrics ttff={ttff} total={total} attempts={attempts}")
print(f"ttff_ms={ttff} total_ms={total} attempts={attempts}")
PY
}

echo "========== mango N3c verified rails gate $(date -Iseconds) =========="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

if ! curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null; then
  fail "catalog-service /health"
  exit 1
fi
pass "catalog-service /health"

RAILS_JSON="$TMP_DIR/rails.json"
curl -sf --max-time 10 http://127.0.0.1:3020/rails >"$RAILS_JSON" || {
  fail "GET /rails"
  exit 1
}

while IFS= read -r rail_id; do
  [[ -n "$rail_id" ]] || continue
  echo "--- rail: $rail_id ---"
  ITEMS_JSON="$TMP_DIR/rail-${rail_id}.json"
  if ! curl -sf --max-time 20 "http://127.0.0.1:3020/rails/${rail_id}/items" >"$ITEMS_JSON"; then
    fail "GET /rails/${rail_id}/items"
    continue
  fi
  item_count="$(python3 - "$ITEMS_JSON" <<'PY'
import json, sys
print(len(json.load(open(sys.argv[1], encoding="utf-8")).get("items", [])))
PY
)"
  if [[ "$item_count" == "0" ]]; then
    pass "$rail_id 0/0 served items"
    continue
  fi
  rail_checked=0
  rail_passed=0
  while IFS=$'\t' read -r item_type item_id title; do
    [[ -n "$item_id" ]] || continue
    CHECKED=$((CHECKED + 1))
    rail_checked=$((rail_checked + 1))
    OUT_JSON="$TMP_DIR/play-${rail_id}-${item_id}.json"
    echo "play: $rail_id · $title ($item_id)"
    if curl -sf --max-time 70 -X POST http://127.0.0.1:3020/play \
      -H 'content-type: application/json' \
      -d "{\"type\":\"${item_type}\",\"id\":\"${item_id}\"}" >"$OUT_JSON" \
      && metrics="$(check_play_json "$OUT_JSON")"; then
      PASSED=$((PASSED + 1))
      rail_passed=$((rail_passed + 1))
      pass "$item_id $metrics"
    else
      fail "$rail_id $item_id play failed"
    fi
    bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true
  done < <(json_get_items "$ITEMS_JSON")
  if [[ "$rail_checked" == "$rail_passed" ]]; then
    pass "$rail_id ${rail_passed}/${rail_checked} served items"
  fi
done < <(json_get_rails "$RAILS_JSON")

echo
if [[ "$ERRORS" -eq 0 ]]; then
  echo "GATE PASS: N3c verified rails ${PASSED}/${CHECKED} served items"
  exit 0
fi

echo "GATE FAIL: N3c verified rails ${PASSED}/${CHECKED} served items, ${ERRORS} error(s)" >&2
exit 1
