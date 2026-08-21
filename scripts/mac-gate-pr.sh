#!/usr/bin/env bash
# Fast local-pass gate for pull requests. Does not prove Pi or couch behavior.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
failures=0

run() {
  local label="$1"
  shift
  echo "==> $label"
  if "$@"; then
    echo "PASS $label"
  else
    echo "FAIL $label" >&2
    failures=$((failures + 1))
  fi
}

run "catalog unit gate" bash "$ROOT/scripts/lib/gate-catalog-unit.sh" "$ROOT/src/catalog-service"
run "launcher build" bash -lc 'cd src/launcher && npm run build'
if grep -q '"test"' src/launcher/package.json; then
  run "launcher tests" bash -lc 'cd src/launcher && npm test'
fi
run "companion build" bash -lc 'cd src/companion && npm run build'
run "HUD contract" python3 "$ROOT/scripts/m2-catalog/service/test_mango_hud_contract.py"
run "stream picker source" bash "$ROOT/scripts/m6-ship/gate-m6-stream-picker-source.sh"
run "deploy hardening" bash "$ROOT/scripts/m6-ship/test-pi-deploy-hardening.sh"
run "doc links" python3 "$ROOT/scripts/check-doc-links.py"
run "public-surface lint" python3 "$ROOT/scripts/check-public-surface.py"

if (( failures > 0 )); then
  echo "mac-gate-pr: $failures failure(s)" >&2
  exit 1
fi
echo "mac-gate-pr: ok (local-pass only)"
