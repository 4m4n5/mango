#!/usr/bin/env bash
# Thematic rail_pool reorganization — prune mismatches; optional relocate.
#
#   bash scripts/m3-play/playability/rail-pool-retheme.sh dry-run
#   bash scripts/m3-play/playability/rail-pool-retheme.sh dry-run --rail series-reality-casual
#   bash scripts/m3-play/playability/rail-pool-retheme.sh apply
#
# Profiles: config/rail-theme-profiles.yaml (override: MANGO_RAIL_THEME_PROFILES)

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
export MANGO_REPO_DIR="$REPO_DIR"
export MANGO_RAIL_THEME_PROFILES="${MANGO_RAIL_THEME_PROFILES:-$REPO_DIR/config/rail-theme-profiles.yaml}"

if [[ ! -f "$MANGO_RAIL_THEME_PROFILES" ]]; then
  echo "missing theme profiles: $MANGO_RAIL_THEME_PROFILES" >&2
  exit 2
fi

cd "$REPO_DIR/src/catalog-service"
npm run build --silent
node dist/playability/rail-pool-retheme-cli.js "$@"
