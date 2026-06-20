#!/usr/bin/env bash
# Fast catalog-service unit smoke (no mpv). Assumes pi-deploy already built dist/.

set -euo pipefail

export MANGO_REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=lib/gate-common.sh
source "$(cd "$(dirname "$0")" && pwd)/lib/gate-common.sh"
mango_gate_init

bash "$REPO_DIR/scripts/lib/gate-play-ladder-core.sh" \
  && gate_pass "catalog unit" || { gate_fail "catalog unit"; exit 1; }
