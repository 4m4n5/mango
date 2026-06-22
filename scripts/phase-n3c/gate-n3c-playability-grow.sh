#!/usr/bin/env bash
# Gate: Library Grower PR4 — playability-grow entrypoint, collapsed refresh levels, mode+preset API.
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

echo "== gate-n3c-playability-grow =="

npm --prefix src/catalog-service run test 2>&1 | tail -8

test -x scripts/phase-n3c/playability-grow.sh
grep -q 'grow_quick' src/catalog-service/src/playability/refresh-control.ts
grep -q 'resolveRefreshLevelId' src/catalog-service/src/playability/refresh-control.ts
grep -q 'startRefreshJob' src/catalog-service/src/playability/refresh-control.ts
grep -q 'playability-grow.sh' scripts/phase-n3c/playability-refresh-level.sh
grep -q '\-\-preset' scripts/phase-n3c/playability-indexer.ts
grep -q 'startRefreshJob' src/catalog-service/src/index.ts

bash scripts/phase-n3c/playability-grow.sh --help >/dev/null

echo "N3c playability-grow gate ok"
