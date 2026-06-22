#!/usr/bin/env bash
# Gate: per-source ingest cursors (Library Grower PR2).
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

echo "== gate-n3c-source-cursors =="

npm --prefix src/catalog-service run test 2>&1 | tail -8

grep -q 'rail_source_ingest_state' src/catalog-service/src/playability/db.ts
grep -q 'ensureRailSourceIngestOffsets' src/catalog-service/src/playability/db.ts
grep -q 'SourceCursorListSource' src/catalog-service/src/playability/list-source.ts
grep -q 'sources_touched' src/catalog-service/src/playability/candidate-ingest.ts
grep -q 'loadSourceOffsetsForListSource' src/catalog-service/src/playability/grow-rail.ts

echo "N3c source cursors gate ok"
