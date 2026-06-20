#!/usr/bin/env bash
# LLM rail curation — couch-testable entry point.
#
# Usage:
#   bash scripts/phase-n3d/rail-curate.sh sync
#   bash scripts/phase-n3d/rail-curate.sh couch-measure    # Pi: probe → inventory → export-llm
#   bash scripts/phase-n3d/rail-curate.sh export
#   bash scripts/phase-n3d/rail-curate.sh plan proposal.json
#   bash scripts/phase-n3d/rail-curate.sh apply proposal.json [--write]
#
# Doc: config/LLM-rail-curation.md

set -euo pipefail
REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
PIPE="$REPO_DIR/scripts/phase-n3d/mdblist-catalog-pipeline.sh"

cmd="${1:-}"
shift || true

case "$cmd" in
  sync) exec bash "$PIPE" sync "$@" ;;
  couch-measure) exec bash "$PIPE" couch-measure "$@" ;;
  measure) exec bash "$PIPE" measure "$@" ;;
  export) exec bash "$PIPE" export-llm "$@" ;;
  plan)
    proposal="${1:-}"
    [[ -f "$proposal" ]] || { echo "usage: $0 plan proposal.json" >&2; exit 2; }
    exec python3 "$REPO_DIR/scripts/phase-n3d/rail-compose.py" plan "$proposal"
    ;;
  apply)
    proposal="${1:-}"
    [[ -f "$proposal" ]] || { echo "usage: $0 apply proposal.json [--write]" >&2; exit 2; }
    shift || true
    exec python3 "$REPO_DIR/scripts/phase-n3d/rail-compose.py" apply "$proposal" "$@"
    ;;
  ""|help|-h|--help)
    sed -n '2,12p' "$0"
    ;;
  *)
    echo "unknown: $cmd (try: sync | couch-measure | export | plan | apply)" >&2
    exit 2
    ;;
esac
