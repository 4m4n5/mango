#!/usr/bin/env bash
# N5c companion memory gate — profile, journal, compile notes (no LLM API).
# Usage: bash scripts/phase-n5/gate-n5c-companion-memory.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
CATALOG_DIR="$REPO_DIR/src/catalog-service"

cd "$CATALOG_DIR"
npm run build >/dev/null
node --test dist/companion/profile.test.js dist/companion/journal.test.js dist/companion/compile-notes.test.js dist/companion/reflect.test.js dist/companion/gardener.test.js

echo "PASS: N5c companion memory unit tests"
