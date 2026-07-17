#!/usr/bin/env bash
# Regression: deploy sync must keep /etc catalog-live qualification policies fresh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYNC="$SCRIPT_DIR/sync-etc-mango-config.sh"
grep -q 'catalog-live.example.yaml' "$SYNC" \
  || { echo "FAIL: sync-etc-mango-config.sh does not sync catalog-live.yaml" >&2; exit 1; }
grep -q 'catalog-live.yaml' "$SYNC" \
  || { echo "FAIL: missing catalog-live.yaml dest in sync-etc" >&2; exit 1; }
echo "PASS: sync-etc keeps catalog-live qualification policies in sync"
