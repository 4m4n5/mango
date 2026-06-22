#!/usr/bin/env bash
# Gate: Library Grower PR1 — growRail loop, tier targets, probe-only metric.
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

echo "== gate-m3-grow-rail =="

npm --prefix src/catalog-service run test 2>&1 | tail -8

test -f src/catalog-service/src/playability/grow-rail.ts
test -f src/catalog-service/src/playability/grow-target.ts
grep -q 'export async function growRail' src/catalog-service/src/playability/grow-rail.ts
grep -q 'candidates.length === 0' src/catalog-service/src/playability/grow-rail.ts
grep -q 'madeLinkOrProbeProgress' src/catalog-service/src/playability/grow-rail.ts
grep -q 'resolveGrowTarget' src/catalog-service/src/playability/grow-target.ts
grep -q 'isGrowRefreshMode' src/catalog-service/src/playability/grow-target.ts
grep -q 'refreshAllRailsGrow' src/catalog-service/src/playability/refresh.ts
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
print("catalog growth config ok")
PY

echo "N3c grow-rail gate ok"
