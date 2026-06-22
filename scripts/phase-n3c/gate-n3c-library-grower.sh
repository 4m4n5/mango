#!/usr/bin/env bash
# Gate: Library Grower PR3 — grow/stale modes, nightly sequence, yaml grow_per_pass.
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

echo "== gate-n3c-library-grower =="

npm --prefix src/catalog-service run test 2>&1 | tail -8

grep -q "export type RefreshMode = 'grow' | 'stale'" src/catalog-service/src/playability/grow-target.ts
grep -q 'normalizeRefreshMode' src/catalog-service/src/playability/grow-target.ts
grep -q '"nightly"' scripts/phase-n3c/playability-maintenance.sh
grep -q 'phase 1: stale refresh' scripts/phase-n3c/playability-maintenance.sh
grep -q '\-\-mode nightly' scripts/phase-n3c/install-playability-timer.sh
grep -q 'grow_per_pass' src/catalog-service/src/rails.ts

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
    assert play.get("grow_per_pass", 0) >= 20, f"{rail['id']} missing grow_per_pass"
    assert "growth_quota" not in play, f"{rail['id']} still has growth_quota"
    assert "growth_attempt_budget" not in play, f"{rail['id']} still has growth_attempt_budget"
print("catalog grow_per_pass ok")
PY

echo "N3c library grower gate ok"
