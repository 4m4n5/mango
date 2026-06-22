#!/usr/bin/env bash
# Sync repo operator config into /etc/mango when passwordless sudo is available.
# Safe no-op when sudo needs a password — mango-stack still uses repo examples via resolve_*.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

sync_one() {
  local src="$1" dest="$2" label="$3"
  [[ -f "$src" ]] || return 0
  if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
    echo "etc-mango: $label already synced"
    return 0
  fi
  if sudo -n cp "$src" "$dest" 2>/dev/null; then
    echo "etc-mango: synced $label -> $dest"
    return 0
  fi
  echo "etc-mango: skip $label (sudo needs password — runtime uses repo example)" >&2
  return 0
}

sync_one "$REPO_DIR/config/catalog-filters.example.json" /etc/mango/catalog-filters.json catalog-filters
sync_one "$REPO_DIR/config/catalog.example.yaml" /etc/mango/catalog.yaml catalog.yaml
bash "$REPO_DIR/scripts/m5-voice/ai/sync-companion-example.sh" || true
