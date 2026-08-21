#!/usr/bin/env bash
# MDBList catalog curation pipeline — sync inventory, validate import, optional compose.
#
# Usage:
#   bash scripts/m4-addons/mdblist-catalog-pipeline.sh sync
#   bash scripts/m4-addons/mdblist-catalog-pipeline.sh sync-curated
#   bash scripts/m4-addons/mdblist-catalog-pipeline.sh export-llm [--tag comedy]
#   bash scripts/m4-addons/mdblist-catalog-pipeline.sh check-import
#   bash scripts/m4-addons/mdblist-catalog-pipeline.sh compose plan proposal.json
#   bash scripts/m4-addons/mdblist-catalog-pipeline.sh compose apply proposal.json [--write]
#   bash scripts/m4-addons/mdblist-catalog-pipeline.sh measure
#   bash scripts/m4-addons/mdblist-catalog-pipeline.sh couch-measure   # Pi: probe + inventory + export
#
# LLM workflow:
#   1. sync (pull https://mdblist.com/toplists/ into config/mdblist-inventory.json)
#   2. export-llm → feed catalogs + active_rails to model
#   3. model outputs JSON matching config/rail-compose.schema.json
#   4. compose plan → review diff
#   5. compose apply --write → catalog.yaml + aiometadata-rail-catalogs.json
#   6. check-import → verify AIOMetadata export covers new mdblist.* ids
#   7. aiometadata-config.sh import + fill-playability-db.sh on Pi

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

INVENTORY="${MANGO_MDBLIST_INVENTORY:-$REPO_DIR/config/mdblist-inventory.json}"
CATALOG_YAML="${MANGO_CATALOG_YAML:-$REPO_DIR/config/catalog.example.yaml}"
LLM_EXPORT="${MANGO_MDBLIST_LLM_EXPORT:-$HOME/.cache/mango/mdblist-llm-context.json}"

cmd="${1:-}"
shift || true

run_sync() {
  local curated="${1:-0}"
  if [[ "$curated" == "1" ]]; then
    python3 "$REPO_DIR/scripts/diag/mdblist-inventory.py" sync-toplists --curated
  else
    python3 "$REPO_DIR/scripts/diag/mdblist-inventory.py" sync-toplists
  fi
}

run_export_llm() {
  mkdir -p "$(dirname "$LLM_EXPORT")"
  python3 "$REPO_DIR/scripts/diag/mdblist-inventory.py" export-llm \
    --limit "${MANGO_MDBLIST_LLM_LIMIT:-80}" \
    --out "$LLM_EXPORT" \
    "$@"
  echo "llm context: $LLM_EXPORT"
  python3 - "$LLM_EXPORT" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
print(f"catalogs: {len(data.get('catalogs', []))}")
print(f"active_rails: {len(data.get('active_rails', []))}")
PY
}

run_measure() {
  python3 "$REPO_DIR/scripts/diag/mdblist-inventory.py" measure "$@"
}

run_check_import() {
  local import_json="${MANGO_AIOMETADATA_IMPORT:-$HOME/.config/mango/aiometadata-import.json}"
  if [[ ! -f "$import_json" ]]; then
    echo "WARN: no import export at $import_json — add lists in AIOMetadata configure UI first" >&2
    echo "  then: bash scripts/m4-addons/aiometadata-config.sh check $import_json" >&2
    return 1
  fi
  MANGO_CATALOG_YAML="$CATALOG_YAML" bash "$REPO_DIR/scripts/m4-addons/aiometadata-config.sh" check "$import_json"
}

case "$cmd" in
  sync) run_sync 0 ;;
  sync-curated) run_sync 1 ;;
  export-llm) run_export_llm "$@" ;;
  measure) run_measure "$@" ;;
  couch-measure)
    echo "== couch-measure (catalog-service should be up) =="
    MANGO_SOURCE_HITRATE_PER_SOURCE="${MANGO_SOURCE_HITRATE_PER_SOURCE:-5}" \
      python3 "$REPO_DIR/scripts/diag/source-hitrate.py" || true
    run_measure
    run_export_llm
    echo "--- deployed catalogs ---"
    python3 "$REPO_DIR/scripts/diag/mdblist-inventory.py" list --limit 12 || true
    ;;
  check-import) run_check_import ;;
  compose)
    sub="${1:-}"
    shift || true
    [[ -n "$sub" ]] || { echo "usage: … compose plan|apply proposal.json" >&2; exit 2; }
    extra=()
    if [[ "${1:-}" == "--write" ]]; then
      extra=(--write)
      shift
    fi
    proposal="${1:-}"
    [[ -f "$proposal" ]] || { echo "missing proposal: $proposal" >&2; exit 2; }
    python3 "$REPO_DIR/scripts/m4-addons/rail-compose.py" "$sub" "$proposal" "${extra[@]}"
    ;;
  full)
    run_sync 0
    run_export_llm
    echo "--- top comedy (inventory) ---"
    python3 "$REPO_DIR/scripts/diag/mdblist-inventory.py" list --tag comedy --limit 10 || true
    ;;
  *)
    echo "usage: $0 sync|sync-curated|export-llm|measure|couch-measure|check-import|compose|full" >&2
    exit 2
    ;;
esac
