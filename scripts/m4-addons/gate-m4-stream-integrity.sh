#!/usr/bin/env bash
# Gate: stream integrity — filename/size filters, play-order picker, verify drift.
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_DIR"

echo "== gate-m4-stream-integrity =="

npm --prefix src/catalog-service run test 2>&1 | tail -8

grep -q 'streamPassesIntegrity' src/catalog-service/src/stream-filters.ts
grep -q 'streamFilenameHaystack' src/catalog-service/src/stream-filters.ts
grep -q 'isSuspiciousFeatureSize' src/catalog-service/src/stream-filters.ts
grep -q 'demoteVerifyIfDrifted' src/catalog-service/src/playability/verify.ts
grep -q 'expandPlayLadder' src/catalog-service/src/core.ts
grep -q 'play_ladder_preview' src/catalog-service/src/stream-filters.ts
grep -q 'min_unique_urls": 1' config/stream-gate-fixtures.json
test -f scripts/diag/ladder-breakdown.ts

echo "N3d stream integrity gate ok"
