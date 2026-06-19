#!/usr/bin/env bash
# Phase N2 browse gate — rails API + launcher proxy (no nested N1/N0).

set -euo pipefail

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init
gate_header "mango N2 browse gate"

EXPECTED_RAILS=(trending-india popular-india recommended-india popular-global featured-global)
STRICT_RAILS=(trending-india popular-india recommended-india popular-global)

bash scripts/phase-n2/check-n2-prereqs.sh >/dev/null && gate_pass "prereqs" || gate_fail "prereqs"

if curl -sf --max-time 5 http://127.0.0.1:3020/rails >/tmp/mango-n2-rails.json; then
  python3 - "${EXPECTED_RAILS[@]}" <<'PY' && gate_pass "GET /rails" || gate_fail "GET /rails ids"
import json, sys
expected = sys.argv[1:]
ids = [r.get("id") for r in json.load(open("/tmp/mango-n2-rails.json")).get("rails", [])]
missing = [r for r in expected if r not in ids]
if missing:
    raise SystemExit(f"missing {missing}")
PY
else
  gate_fail "GET /rails"
fi

for rail in "${EXPECTED_RAILS[@]}"; do
  out="/tmp/mango-n2-${rail}.json"
  min_items=0
  for strict in "${STRICT_RAILS[@]}"; do [[ "$rail" == "$strict" ]] && min_items=1; done
  if curl -sf --max-time 30 "http://127.0.0.1:3020/rails/${rail}/items" >"$out"; then
    python3 - "$out" "$rail" "$min_items" <<'PY' && gate_pass "${rail} items" || gate_fail "${rail} items"
import json, sys
path, rail, min_items = sys.argv[1], sys.argv[2], int(sys.argv[3])
items = json.load(open(path)).get("items") or []
if len(items) < min_items:
    raise SystemExit(f"{rail}: {len(items)} < {min_items}")
bad = [i.get("poster","") for i in items if not str(i.get("poster","")).startswith("https://")]
if bad:
    raise SystemExit(f"{rail}: bad posters")
PY
  else
    gate_fail "GET /rails/${rail}/items"
  fi
done

curl -sf --max-time 5 http://127.0.0.1:3000/api/catalog/rails >/dev/null \
  && gate_pass "launcher proxy" || gate_fail "launcher proxy"
[[ -f src/launcher/dist/index.html ]] && gate_pass "launcher dist" || gate_fail "launcher dist"

gate_finish "N2 gate" || exit 1
