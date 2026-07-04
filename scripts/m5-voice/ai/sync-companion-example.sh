#!/usr/bin/env bash
# Seed /etc/mango/companion from repo examples when missing (never overwrite live profile).
# persona.md: sync from repo on every run — git is source of truth for tone/policy.
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
EXAMPLE="$REPO_DIR/config/companion.example"
DEST="/etc/mango/companion"
VOICE_ENV="${HOME}/.config/mango/voice.env"

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

sync_persona() {
  local repo_persona="$EXAMPLE/persona.md"
  if [[ ! -f "$repo_persona" ]]; then
    echo "companion: missing $repo_persona" >&2
    return 1
  fi
  if sudo -n mkdir -p "$DEST" 2>/dev/null && sudo -n cp "$repo_persona" "$DEST/persona.md" 2>/dev/null; then
    echo "companion: synced persona.md -> $DEST/persona.md"
    return 0
  fi
  mkdir -p "$(dirname "$VOICE_ENV")"
  touch "$VOICE_ENV"
  local dir_line="export MANGO_COMPANION_DIR=\"$EXAMPLE\""
  if grep -q '^export MANGO_COMPANION_DIR=' "$VOICE_ENV" 2>/dev/null; then
    sed -i.bak "s|^export MANGO_COMPANION_DIR=.*|$dir_line|" "$VOICE_ENV"
    rm -f "${VOICE_ENV}.bak"
  else
    printf '\n# Persona from repo (sudo unavailable for /etc/mango/companion)\n%s\n' "$dir_line" >>"$VOICE_ENV"
  fi
  echo "companion: persona via MANGO_COMPANION_DIR=$EXAMPLE"
}

seed_if_missing profile.yaml
sync_persona
echo "companion: sync done"
