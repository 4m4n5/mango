#!/usr/bin/env bash
# Phase N3a gate — play preference ladder (unit + config contract).

set -euo pipefail

export MANGO_REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init

REPO_DIR="$MANGO_REPO_DIR"
CATALOG_DIR="$REPO_DIR/src/catalog-service"

gate_header "mango N3a play-ladder gate"

[[ -d "$CATALOG_DIR" ]] || { gate_fail "catalog-service missing"; exit 1; }

python3 - "$REPO_DIR/config/catalog-filters.example.json" <<'PY' \
  && gate_pass "play_ladder config contract" || gate_fail "play_ladder config contract"
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
ladder = data.get("play_ladder") or []
assert len(ladder) >= 3, "play_ladder needs at least 3 steps"
assert data.get("preferred_quality") == "1080p", "preferred_quality must be 1080p"
assert int(data.get("auto_play_wall_ms") or 0) >= 60000, "auto_play_wall_ms too low for ladder"
assert int(data.get("auto_play_max_attempts") or 0) >= 8, "auto_play_max_attempts too low"
steps = [step.get("step") for step in ladder]
assert steps[0] == "ideal", "first ladder step must be ideal"
for step in ladder:
    addons = [str(item).lower() for item in step.get("addons", [])]
    assert any("aiostreams" in item for item in addons), f"{step.get('step')}: needs AIOStreams"
PY

(
  cd "$CATALOG_DIR"
  npm run build >/dev/null
  node --test dist/play-ladder.test.js dist/play-orchestrator.test.js dist/preflight-playback.test.js
) && gate_pass "play-ladder unit tests" || gate_fail "play-ladder unit tests"

gate_finish "N3a play-ladder gate" || exit 1
