#!/usr/bin/env bash
# N5b gate — AI catalog store, voice tools manifest, overflow contract.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
CATALOG_DIR="$REPO_DIR/src/catalog-service"
EXAMPLE_DIR="$REPO_DIR/config/ai-catalogs.example"

cd "$CATALOG_DIR"
npm run build >/dev/null

node --test dist/ai-catalogs/store.test.js dist/ai-catalogs/list-source.test.js dist/ai-catalogs/compose.test.js

node - <<'NODE'
import { buildVoiceToolManifest } from './dist/voice/tools.js';
const names = buildVoiceToolManifest().tools.map((tool) => tool.name);
for (const required of [
  'mango_list_ai_catalogs',
  'mango_create_ai_catalog',
  'mango_update_ai_catalog',
  'mango_delete_ai_catalog',
  'mango_refresh_ai_catalog',
]) {
  if (!names.includes(required)) {
    console.error('missing voice tool:', required);
    process.exit(1);
  }
}
NODE

example_slot="$EXAMPLE_DIR/slots/cozy-nights-example.yaml"
if [[ ! -f "$example_slot" ]]; then
  echo "missing example ai catalog slot: $example_slot" >&2
  exit 1
fi

grep -q 'slot_id: cozy-nights-example' "$example_slot"
grep -q 'llm_hints:' "$example_slot"

echo "N5b ai-catalogs gate ok"
