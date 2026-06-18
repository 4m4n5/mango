#!/usr/bin/env bash
# Phase N2 browse gate — rails API, launcher proxy, poster data, regressions.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

EXPECTED_RAILS=(
  trending-india
  popular-india
  recommended-india
  popular-global
  featured-global
)
STRICT_RAILS=(
  trending-india
  popular-global
)

ERRORS=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }
warn() { echo "WARN: $*" >&2; }

echo "========== mango N2 browse gate $(date -Iseconds) =========="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

echo "--- prereqs ---"
bash scripts/phase-n2/check-n2-prereqs.sh && pass "check-n2-prereqs" || fail "check-n2-prereqs"

echo "--- rails API ---"
if curl -sf --max-time 5 http://127.0.0.1:3020/rails >/tmp/mango-n2-rails.json; then
  python3 - "${EXPECTED_RAILS[@]}" <<'PY' && pass "GET /rails expected ids" || fail "GET /rails ids"
import json
import sys
expected = sys.argv[1:]
data = json.load(open("/tmp/mango-n2-rails.json", encoding="utf-8"))
ids = [rail.get("id") for rail in data.get("rails", [])]
missing = [rail for rail in expected if rail not in ids]
if missing:
    raise SystemExit(f"missing rails: {missing}; got {ids}")
print("  rails:", ", ".join(ids))
PY
else
  fail "GET /rails"
fi

for rail in "${EXPECTED_RAILS[@]}"; do
  out="/tmp/mango-n2-${rail}.json"
  if curl -sf --max-time 70 "http://127.0.0.1:3020/rails/${rail}/items" >"$out"; then
    min_items=0
    for strict in "${STRICT_RAILS[@]}"; do
      if [[ "$rail" == "$strict" ]]; then
        min_items=3
      fi
    done
    python3 - "$out" "$rail" "$min_items" <<'PY' && pass "${rail} items" || fail "${rail} items"
import json
import sys
path, rail, min_items = sys.argv[1], sys.argv[2], int(sys.argv[3])
data = json.load(open(path, encoding="utf-8"))
items = data.get("items") or []
posters = [item.get("poster", "") for item in items]
bad = [poster for poster in posters if not poster.startswith("https://")]
if len(items) < min_items:
    raise SystemExit(f"{rail}: expected >= {min_items} items, got {len(items)}")
if bad:
    raise SystemExit(f"{rail}: non-https poster urls: {bad[:2]}")
print(f"  {rail}: items={len(items)} resolve_ms={data.get('resolve_ms')}")
PY
    if [[ "$min_items" -eq 0 ]]; then
      python3 - "$out" "$rail" <<'PY' || warn "${rail} empty from source"
import json
import sys
path, rail = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding="utf-8"))
items = data.get("items") or []
if len(items) == 0:
    raise SystemExit(f"{rail}: source returned 0 items")
PY
    fi
  else
    fail "GET /rails/${rail}/items"
  fi
done

echo "--- launcher proxy ---"
if curl -sf --max-time 5 http://127.0.0.1:3000/api/catalog/rails >/tmp/mango-n2-proxy-rails.json; then
  python3 - <<'PY' && pass "launcher proxy /api/catalog/rails" || fail "launcher proxy rail count"
import json
data = json.load(open("/tmp/mango-n2-proxy-rails.json", encoding="utf-8"))
assert len(data.get("rails") or []) >= 5
PY
else
  fail "GET :3000/api/catalog/rails"
fi

echo "--- launcher build ---"
if [[ -f src/launcher/dist/index.html ]] && grep -R "/api/catalog/rails" src/launcher/dist >/dev/null 2>&1; then
  pass "launcher dist contains catalog rails fetch"
else
  fail "launcher dist missing catalog rails fetch (rebuild src/launcher)"
fi

echo "--- N1 regression ---"
bash scripts/phase-n1/gate-n1-smoke.sh && pass "gate-n1-smoke" || fail "gate-n1-smoke"

echo "--- N0 regression ---"
bash scripts/phase-n0/gate-n0.sh && pass "gate-n0" || fail "gate-n0"

echo
if [[ "$ERRORS" -eq 0 ]]; then
  echo "N2 gate: PASS"
  exit 0
fi
echo "N2 gate: FAIL (${ERRORS} errors)"
exit 1
