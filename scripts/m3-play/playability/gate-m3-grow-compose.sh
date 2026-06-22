#!/usr/bin/env bash
# Gate: Library Grower PR5 — AI compose escalation on grow exhaustion.
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$REPO_DIR"

echo "== gate-m3-grow-compose =="

npm --prefix src/catalog-service run test 2>&1 | tail -8

test -f src/catalog-service/src/ai-catalogs/grow-compose-escalation.ts
grep -q 'tryGrowComposeEscalation' src/catalog-service/src/playability/grow-rail.ts
grep -q 'tryComposeOnExhaustion' src/catalog-service/src/playability/grow-rail.ts
grep -q 'compose_fallback_level' src/catalog-service/src/ai-catalogs/types.ts
grep -q 'resetRailIngestCursors' src/catalog-service/src/playability/db.ts

echo "N3c grow-compose gate ok"
