#!/usr/bin/env bash
# Phase N2 prerequisite check — catalog.yaml + service + launcher build.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

CATALOG_YAML="${MANGO_CATALOG_YAML:-/etc/mango/catalog.yaml}"
EXPECTED_RAILS=(
  trending-india
  popular-india
  recommended-india
  popular-global
  featured-global
)

ERRORS=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }
warn() { echo "WARN: $*" >&2; }

echo "=== N2 prereq check $(date -Iseconds) ==="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "catalog yaml: ${CATALOG_YAML}"
echo

if [[ -f "$CATALOG_YAML" ]]; then
  pass "$CATALOG_YAML exists"
  for rail in "${EXPECTED_RAILS[@]}"; do
    if grep -Eq "^[[:space:]]*-[[:space:]]*id:[[:space:]]*['\"]?${rail}['\"]?[[:space:]]*$" "$CATALOG_YAML"; then
      pass "yaml rail ${rail}"
    else
      fail "yaml missing rail ${rail}"
    fi
  done
else
  fail "missing $CATALOG_YAML (copy config/catalog.example.yaml)"
fi

if [[ -f /etc/mango/tmdb.key ]]; then
  pass "/etc/mango/tmdb.key present (not required for N2)"
else
  pass "tmdb key not required for N2 addon_catalog rails"
fi

if [[ -f src/catalog-service/dist/index.js ]]; then
  pass "catalog-service dist built"
else
  fail "catalog-service dist missing — cd src/catalog-service && npm ci && npm run build"
fi

if curl -sf --max-time 3 http://127.0.0.1:3020/health >/tmp/mango-n2-health.json 2>/dev/null; then
  pass "catalog-service :3020 health"
else
  fail "catalog-service :3020 not reachable (MANGO_CATALOG=1 bash scripts/mango-stack.sh restart)"
fi

if curl -sf --max-time 5 http://127.0.0.1:3020/rails >/tmp/mango-n2-rails.json 2>/dev/null; then
  python3 - <<'PY' && pass "GET /rails >=5" || fail "GET /rails returned fewer than 5 rails"
import json
data = json.load(open("/tmp/mango-n2-rails.json", encoding="utf-8"))
rails = data.get("rails") or []
assert len(rails) >= 5, len(rails)
print("  rails:", ", ".join(rail.get("id", "?") for rail in rails))
PY
else
  fail "GET /rails failed"
fi

if [[ -f src/launcher/dist/index.html ]]; then
  pass "launcher dist built"
else
  fail "launcher dist missing — cd src/launcher && npm ci && npm run build"
fi

echo
if [[ "$ERRORS" -eq 0 ]]; then
  echo "N2 prereqs: READY"
  exit 0
fi
echo "N2 prereqs: NOT READY ($ERRORS blocking)"
exit 1
