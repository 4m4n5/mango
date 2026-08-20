#!/usr/bin/env bash
# Regression coverage for fail-closed Pi deploy preflight.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../lib/pi-deploy-preflight.sh
source "$ROOT/scripts/lib/pi-deploy-preflight.sh"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

if mango_require_deploy_branch "main" 2>/dev/null; then
  fail "wrong branch was accepted"
fi
pass "wrong branch refused"

mango_require_deploy_branch "feat/native-experience"
pass "required branch accepted"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git init -q "$tmp"
git -C "$tmp" config user.email test@example.com
git -C "$tmp" config user.name test
echo one >"$tmp/file"
git -C "$tmp" add file
git -C "$tmp" commit -qm init
if mango_refuse_unexpected_dirty "$tmp" "fixture" 2>/dev/null; then
  pass "clean tree accepted"
else
  fail "clean tree refused"
fi
echo dirty >>"$tmp/file"
if mango_refuse_unexpected_dirty "$tmp" "fixture" 2>/dev/null; then
  fail "dirty tree was accepted"
fi
pass "dirty tree refused"
MANGO_DEPLOY_ALLOW_DIRTY=1 mango_refuse_unexpected_dirty "$tmp" "fixture"
pass "explicit dirty override accepted"

sha="$(git -C "$tmp" rev-parse HEAD)"
mango_require_sha "fixture" "$sha" "$sha"
if mango_require_sha "fixture" "$sha" "deadbeef" 2>/dev/null; then
  fail "sha mismatch was accepted"
fi
pass "sha mismatch refused"

if ! grep -q 'MANGO_SKIP_AIOMETADATA_SYNC=1 bash scripts/m4-addons/sync-aiometadata-rail-catalogs.sh' "$ROOT/scripts/pi-deploy.sh"; then
  fail "default AIOMetadata skip is not forwarded"
fi
if ! grep -q 'MANGO_SYNC_AIOMETADATA' "$ROOT/scripts/pi-deploy.sh"; then
  fail "AIOMetadata opt-in flag missing"
fi
pass "AIOMetadata skip is forwarded and opt-in"

echo "PASS: pi deploy preflight"
