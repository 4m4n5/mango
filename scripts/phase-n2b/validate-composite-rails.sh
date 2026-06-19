#!/usr/bin/env bash
# Smoke composite_list rails — candidate ingest counts (needs catalog-service up).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

CATALOG_YAML="${MANGO_CATALOG_YAML:-$REPO_DIR/config/catalog.example.yaml}"
export MANGO_CATALOG_YAML="$CATALOG_YAML"

npm --prefix src/catalog-service exec tsx -- scripts/phase-n2b/smoke-composite-rails.ts
