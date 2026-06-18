#!/usr/bin/env bash
# S1 — stremio-core-web boot on Pi. See phase-n1-catalog-play-spike.md §4 S1.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

EXPORT="/etc/mango/stremio-export.json"
SPIKE_DIR="${REPO_DIR}/src/catalog-service"

if [[ ! -f "$EXPORT" ]]; then
  echo "FAIL: missing $EXPORT — paste Stremio export on Pi first" >&2
  exit 1
fi

if ! command -v node >/dev/null; then
  echo "FAIL: node not installed" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "FAIL: node >= 20 required (have $(node --version))" >&2
  exit 1
fi

if [[ ! -f "${SPIKE_DIR}/scripts/spike-core-boot.mjs" ]]; then
  echo "FAIL: implement ${SPIKE_DIR}/scripts/spike-core-boot.mjs (N1)" >&2
  echo "  Must load @stremio/stremio-core-web with addons from $EXPORT" >&2
  exit 1
fi

echo "S1: stremio-core boot spike"
node "${SPIKE_DIR}/scripts/spike-core-boot.mjs" "$EXPORT"
