#!/usr/bin/env bash
# Mirror the active couch stream policy into /etc/mango/catalog-filters.json.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

# shellcheck source=catalog-yaml.sh
source "$REPO_DIR/scripts/lib/catalog-yaml.sh"
sync_catalog_filters_etc
