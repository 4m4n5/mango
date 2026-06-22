#!/usr/bin/env bash
# Seed /etc/mango/companion from repo examples when missing (never overwrite live profile).
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
EXAMPLE="$REPO_DIR/config/companion.example"
DEST="/etc/mango/companion"

seed_if_missing() {
  local name="$1"
  if [[ -f "$DEST/$name" ]]; then
    echo "companion: $name exists — skip"
    return 0
  fi
  if [[ ! -f "$EXAMPLE/$name" ]]; then
    echo "companion: missing example $EXAMPLE/$name" >&2
    return 1
  fi
  if sudo -n mkdir -p "$DEST" 2>/dev/null && sudo -n cp "$EXAMPLE/$name" "$DEST/$name" 2>/dev/null; then
    echo "companion: seeded $name -> $DEST/$name"
    return 0
  fi
  echo "companion: skip seed $name (sudo needs password)" >&2
  return 0
}

seed_if_missing profile.yaml
seed_if_missing persona.md
echo "companion: sync done"
