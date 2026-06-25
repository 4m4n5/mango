#!/usr/bin/env bash
# Foreground catalog-service runner for systemd and stack scripts.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

if [[ "${MANGO_CATALOG:-1}" != "1" ]]; then
  echo "catalog-service disabled: MANGO_CATALOG=${MANGO_CATALOG:-0}" >&2
  exit 1
fi

if [[ ! -f src/catalog-service/dist/index.js ]]; then
  echo "catalog-service dist missing; run: cd src/catalog-service && npm ci && npm run build" >&2
  exit 1
fi

# shellcheck source=../../lib/catalog-yaml.sh
source "$REPO_DIR/scripts/lib/catalog-yaml.sh"

catalog_yaml="$(resolve_catalog_yaml)"
catalog_filters="$(resolve_catalog_filters)"

cd "$REPO_DIR/src/catalog-service"
exec env \
  MANGO_REPO_DIR="$REPO_DIR" \
  MANGO_CATALOG_YAML="$catalog_yaml" \
  MANGO_CATALOG_FILTERS="$catalog_filters" \
  node dist/index.js
