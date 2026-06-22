#!/usr/bin/env bash
# Gate: growth-quota playability mode (Phase 1+2).
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

echo "== gate-n3c-growth-quota =="

npm --prefix src/catalog-service run test 2>&1 | tail -5

python3 - <<'PY'
import yaml
from pathlib import Path

catalog = yaml.safe_load(Path("config/catalog.example.yaml").read_text(encoding="utf-8"))
for rail in catalog.get("rails") or []:
    if rail.get("enabled") is False:
        continue
    if rail.get("type") not in {"addon_catalog", "composite_list"}:
        continue
    play = rail.get("playability") or {}
    assert play.get("growth_quota", 0) >= 20, f"{rail['id']} missing growth_quota"
    assert play.get("growth_attempt_budget", 0) >= 40, f"{rail['id']} missing growth_attempt_budget"
    assert "pool_max" not in play or play.get("pool_max") is None, f"{rail['id']} still has pool_max cap"
print("catalog growth config ok")
PY

grep -q 'RefreshMode = .full. | .stale. | .growth.' src/catalog-service/src/playability/refresh.ts
grep -q 'mode === .growth.' src/catalog-service/src/playability/refresh.ts
grep -q 'MANGO_PLAYABILITY_REFRESH_MODE=growth' scripts/phase-n3c/install-playability-timer.sh

echo "N3c growth quota gate ok"
