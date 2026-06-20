#!/usr/bin/env bash
# Shared play-ladder contract + catalog unit slice (no gate header/finish).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:?}"
CATALOG_DIR="$REPO_DIR/src/catalog-service"
FILTERS="${REPO_DIR}/config/catalog-filters.example.json"
STRICT="${1:-}"

[[ -d "$CATALOG_DIR" ]] || { echo "catalog-service missing" >&2; exit 1; }

if [[ "$STRICT" == "--strict" ]]; then
  python3 "$REPO_DIR/scripts/lib/verify-play-ladder-config.py" "$FILTERS" --strict
else
  python3 "$REPO_DIR/scripts/lib/verify-play-ladder-config.py" "$FILTERS"
fi

bash "$REPO_DIR/scripts/lib/gate-catalog-unit.sh" "$CATALOG_DIR"
