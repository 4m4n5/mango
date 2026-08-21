#!/usr/bin/env bash
# N2 prerequisites — yaml rails + built artifacts.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"
QUIET="${MANGO_GATE_QUIET:-0}"
log() { [[ "$QUIET" == "1" ]] || echo "$@"; }

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

CATALOG_YAML="${MANGO_CATALOG_YAML:-/etc/mango/catalog.yaml}"
EXPECTED=(
  movies-global-popular movies-india-trending movies-classics movies-comedy movies-quick-watches movies-documentaries
  series-global-popular series-india-picks series-classics series-comedy series-miniseries series-reality-casual
)
ERRORS=0
fail() { log "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }

[[ -f "$CATALOG_YAML" ]] || fail "missing $CATALOG_YAML"
for rail in "${EXPECTED[@]}"; do
  grep -Eq "^[[:space:]]*-[[:space:]]*id:[[:space:]]*['\"]?${rail}['\"]?[[:space:]]*$" "$CATALOG_YAML" \
    || fail "yaml missing rail $rail"
done
[[ -f src/catalog-service/dist/index.js ]] || fail "catalog-service dist missing"
[[ -f src/launcher/dist/index.html ]] || fail "launcher dist missing"
curl -sf --max-time 3 http://127.0.0.1:3020/health >/dev/null || fail "catalog :3020 down"
curl -sf --max-time 5 http://127.0.0.1:3020/rails >/dev/null || fail "GET /rails failed"

(( ERRORS == 0 ))
