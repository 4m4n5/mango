#!/usr/bin/env bash
# AI catalog rail tooling — generate / refresh static candidate pools for ai_catalog rails.
#
# Goal: same playability funnel as mdblist rails (ingest → verify → rail_pool).
# Output: /etc/mango/ai-catalogs/<rail-id>.json
#
# Usage (stub — implement generation step):
#   bash scripts/phase-n3d/ai-catalog-refresh.sh --rail movies-ai-picks --dry-run
#
# Env:
#   MANGO_AI_CATALOG_DIR   default /etc/mango/ai-catalogs
#   MANGO_AI_CATALOG_MODEL optional LLM id for generation

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
OUT_DIR="${MANGO_AI_CATALOG_DIR:-/etc/mango/ai-catalogs}"
RAIL=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rail) RAIL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$RAIL" ]] || { echo "usage: $0 --rail <rail-id> [--dry-run]" >&2; exit 2; }

EXAMPLE="$REPO_DIR/config/ai-catalogs.example/${RAIL}.json"
TARGET="$OUT_DIR/${RAIL}.json"

echo "== ai-catalog refresh =="
echo "rail: $RAIL"
echo "target: $TARGET"

if [[ ! -f "$EXAMPLE" ]]; then
  echo "WARN: no example at $EXAMPLE — create schema first" >&2
  exit 1
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY RUN: would write candidates to $TARGET"
  echo "Next: wire LLM/query step, then run playability maintenance on rail"
  exit 0
fi

mkdir -p "$OUT_DIR"
echo "NOT IMPLEMENTED: generation step — copy example as placeholder"
cp "$EXAMPLE" "$TARGET"
echo "wrote placeholder $TARGET (empty items — enable rail after fill)"
