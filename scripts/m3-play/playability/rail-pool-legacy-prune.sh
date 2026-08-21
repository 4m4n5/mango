#!/usr/bin/env bash
# Remove legacy rail_pool rows (pre-yaml ids) — P0 pool geometry.
#
#   bash scripts/m3-play/playability/rail-pool-legacy-prune.sh dry-run
#   bash scripts/m3-play/playability/rail-pool-legacy-prune.sh apply

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
export MANGO_REPO_DIR="$REPO_DIR"
cd "$REPO_DIR/src/catalog-service"
npm run build --silent
node dist/playability/rail-pool-legacy-prune-cli.js "$@"
