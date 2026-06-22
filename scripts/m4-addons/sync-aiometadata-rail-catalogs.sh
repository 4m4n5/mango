#!/usr/bin/env bash
# Ensure AIOMetadata manifest exposes every catalog id referenced by mango rails.
# Safe to run on deploy, grow preflight, and after catalog.yaml changes.
#
# Usage:
#   bash scripts/m4-addons/sync-aiometadata-rail-catalogs.sh [import.json]
#
# Env:
#   MANGO_SKIP_AIOMETADATA_SYNC=1  no-op
#   MANGO_CATALOG_YAML             rail source (default: resolve_catalog_yaml)

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
# shellcheck source=lib/aiometadata.sh
source "$REPO_DIR/scripts/m4-addons/lib/aiometadata.sh"
# shellcheck source=../lib/catalog-yaml.sh
source "$REPO_DIR/scripts/lib/catalog-yaml.sh"

if [[ "${MANGO_SKIP_AIOMETADATA_SYNC:-0}" == "1" ]]; then
  echo "aiometadata-sync: skipped (MANGO_SKIP_AIOMETADATA_SYNC=1)"
  exit 0
fi

export MANGO_CATALOG_YAML="$(resolve_catalog_yaml)" || exit 1
import_json="${1:-${MANGO_AIOMETADATA_IMPORT:-$HOME/.config/mango/aiometadata-import.json}}"

if ! aiometadata_health_ok; then
  echo "aiometadata-sync: skip — AIOMetadata not running ($(aiometadata_health_url))"
  exit 0
fi

if [[ ! -f "$import_json" ]]; then
  echo "aiometadata-sync: skip — no import json at $import_json"
  exit 0
fi

bash "$REPO_DIR/scripts/m4-addons/aiometadata-config.sh" sync-rails "$import_json"
