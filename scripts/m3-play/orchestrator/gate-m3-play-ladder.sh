#!/usr/bin/env bash
# Phase N3a gate — play preference ladder (unit + config contract).

set -euo pipefail

export MANGO_REPO_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

# shellcheck source=../../lib/gate-common.sh
source "$(cd "$(dirname "$0")/../.." && pwd)/lib/gate-common.sh"
mango_gate_init

gate_header "mango N3a play-ladder gate"

bash "$REPO_DIR/scripts/lib/gate-play-ladder-core.sh" --strict \
  && gate_pass "play_ladder + catalog unit" || gate_fail "play_ladder + catalog unit"

gate_finish "N3a play-ladder gate" || exit 1
