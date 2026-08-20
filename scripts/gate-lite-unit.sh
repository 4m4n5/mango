#!/usr/bin/env bash
# Fast catalog-service unit smoke (no mpv). Assumes pi-deploy already built dist/.

set -euo pipefail

export MANGO_REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=lib/gate-common.sh
source "$(cd "$(dirname "$0")" && pwd)/lib/gate-common.sh"
mango_gate_init

bash "$REPO_DIR/scripts/lib/gate-play-ladder-core.sh" \
  && gate_pass "catalog unit" || { gate_fail "catalog unit"; exit 1; }

bash "$REPO_DIR/scripts/m6-ship/test-pi-deploy-hardening.sh" \
  && gate_pass "deploy preflight" || { gate_fail "deploy preflight"; exit 1; }

bash "$REPO_DIR/scripts/m6-ship/test-ensure-youtube-yt-dlp.sh" \
  && gate_pass "youtube yt-dlp slots" || { gate_fail "youtube yt-dlp slots"; exit 1; }

bash "$REPO_DIR/scripts/m6-ship/test-gate-m6-youtube-smoke.sh" \
  && gate_pass "youtube smoke fixtures" || { gate_fail "youtube smoke fixtures"; exit 1; }
