#!/usr/bin/env bash
# Manual rail curation — pins/blocks for discover rails.
#
#   bash scripts/phase-n3c/rail-curation.sh list
#   bash scripts/phase-n3c/rail-curation.sh apply
#   bash scripts/phase-n3c/rail-curation.sh pin add --rail series-comedy --type series --id tt33094114 --label "India's Got Latent"
#
# Config: MANGO_RAIL_CURATION_OVERRIDES or /etc/mango/rail-curation-overrides.yaml
#         (repo default: config/rail-curation-overrides.example.yaml)

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
export MANGO_RAIL_CURATION_OVERRIDES="${MANGO_RAIL_CURATION_OVERRIDES:-$REPO_DIR/config/rail-curation-overrides.example.yaml}"

if [[ ! -f "$MANGO_RAIL_CURATION_OVERRIDES" ]]; then
  echo "missing overrides file: $MANGO_RAIL_CURATION_OVERRIDES" >&2
  echo "copy config/rail-curation-overrides.example.yaml to start" >&2
  exit 2
fi

cd "$REPO_DIR/src/catalog-service"
npm run build --silent
node dist/playability/rail-curation-cli.js "$@"
