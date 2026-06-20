#!/usr/bin/env bash
# Fast catalog-service unit smoke (no mpv). Assumes pi-deploy already built dist/.

set -euo pipefail

export MANGO_REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=lib/gate-common.sh
source "$(cd "$(dirname "$0")" && pwd)/lib/gate-common.sh"
mango_gate_init

CATALOG_DIR="$REPO_DIR/src/catalog-service"

[[ -d "$CATALOG_DIR" ]] || { gate_fail "catalog-service missing"; exit 1; }

python3 - "$REPO_DIR/config/catalog-filters.example.json" <<'PY' \
  && gate_pass "play_ladder config contract" || { gate_fail "play_ladder config contract"; exit 1; }
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
ladder = data.get("play_ladder") or []
assert len(ladder) >= 3, "play_ladder needs at least 3 steps"
assert data.get("preferred_quality") == "1080p", "preferred_quality must be 1080p"
assert int(data.get("auto_play_wall_ms") or 0) >= 60000, "auto_play_wall_ms too low"
steps = [step.get("step") for step in ladder]
assert steps[0] == "ideal", "first ladder step must be ideal"
PY

(
  cd "$CATALOG_DIR"
  if [[ ! -f dist/play-ladder.test.js ]]; then
    npm run build >/dev/null
  fi
  node --test \
    dist/play-ladder.test.js \
    dist/play-orchestrator.test.js \
    dist/preflight-playback.test.js \
    dist/progress/progress.test.js \
    dist/episodes.test.js \
    dist/stream-filters.test.js
) && gate_pass "catalog unit tests" || { gate_fail "catalog unit tests"; exit 1; }
