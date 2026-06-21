#!/usr/bin/env bash
# N5c.3 gate — companion catalog gardener (hints only, no remove_ids).
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR/src/catalog-service"
npm run build >/dev/null
node --test dist/companion/gardener.test.js
echo "PASS: N5c gardener unit tests"
