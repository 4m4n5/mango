#!/usr/bin/env bash
# Gate: Library Grower PR4 — playability-grow entrypoint, collapsed refresh levels, mode+preset API.
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

echo "== gate-m3-playability-grow =="

npm --prefix src/catalog-service run test 2>&1 | tail -8

test -x scripts/m3-play/playability/playability-grow.sh
grep -q 'grow_quick' src/catalog-service/src/playability/refresh-control.ts
grep -q 'resolveRefreshLevelId' src/catalog-service/src/playability/refresh-control.ts
grep -q 'startRefreshJob' src/catalog-service/src/playability/refresh-control.ts
grep -q 'playability-grow.sh' scripts/m3-play/playability/playability-refresh-level.sh
grep -q '\-\-preset' scripts/m3-play/playability/playability-indexer.ts
grep -q 'startRefreshJob' src/catalog-service/src/index.ts

bash scripts/m3-play/playability/playability-grow.sh --help >/dev/null

echo "N3c playability-grow gate ok"
