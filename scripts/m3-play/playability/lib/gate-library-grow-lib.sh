#!/usr/bin/env bash
# Shared checks for Library Grower regression gate (run once per suite).
set -euo pipefail

gate_library_grow_repo() {
  REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
  cd "$REPO_DIR"
}

gate_library_grow_header() {
  echo "== gate-m3-library-grow =="
}

gate_library_grow_tests() {
  echo "-- catalog-service unit tests --"
  npm --prefix src/catalog-service run test 2>&1 | tail -12
}

gate_library_grow_monitor() {
  echo "-- grow monitor --"
  test -f scripts/diag/grow_monitor.py
  test -f scripts/diag/test_grow_monitor.py
  python3 scripts/diag/grow_monitor.py --help >/dev/null
  python3 -m unittest discover -s scripts/diag -p 'test_grow_monitor.py' -v
  python3 -m unittest discover -s scripts/diag -p 'test_ops_grow_sla.py' -v
}

gate_library_grow_entrypoints() {
  echo "-- entrypoints --"
  test -x scripts/m3-play/playability/playability-grow.sh
  bash scripts/m3-play/playability/playability-grow.sh --help >/dev/null
  grep -q 'grow_monitor.py' scripts/m3-play/playability/playability-grow.sh
  grep -q 'grow_monitor.py' scripts/m3-play/playability/playability-maintenance.sh
  grep -q 'list_grow_rail_ids' scripts/diag/ops_grow_sla.py
  grep -q 'railsForGrowPass' src/catalog-service/src/playability/refresh.ts
  grep -q 'flushVerifyContextBatch' src/catalog-service/src/playability/grow-rail.ts
  grep -q 'GROW_DEEP_PAGE_BYPASS_REASONS' src/catalog-service/src/playability/grow-rail.ts
  grep -q 'MANGO_GROW_NO_STREAM_RETRY_MS.*3600000' scripts/m3-play/playability/playability-maintenance.sh
}

gate_library_grow_rail_impl() {
  echo "-- grow rail implementation --"
  test -f src/catalog-service/src/playability/grow-rail.ts
  test -f src/catalog-service/src/playability/grow-order.ts
  test -f src/catalog-service/src/playability/grow-tombstones.ts
  grep -q 'export async function growRail' src/catalog-service/src/playability/grow-rail.ts
  grep -q 'madeLinkOrProbeProgress' src/catalog-service/src/playability/grow-rail.ts
  grep -q 'refreshAllRailsGrow' src/catalog-service/src/playability/refresh.ts
  grep -q 'resolveGrowTarget' src/catalog-service/src/playability/grow-target.ts
  grep -q 'isGrowRefreshMode' src/catalog-service/src/playability/grow-target.ts
  grep -q 'grow_per_pass' src/catalog-service/src/rails.ts
}

gate_library_grow_compose() {
  echo "-- compose escalation --"
  test -f src/catalog-service/src/ai-catalogs/grow-compose-escalation.ts
  grep -q 'tryGrowComposeEscalation' src/catalog-service/src/playability/grow-rail.ts
  grep -q 'tryComposeOnExhaustion' src/catalog-service/src/playability/grow-rail.ts
  grep -q 'compose_fallback_level' src/catalog-service/src/ai-catalogs/types.ts
}

gate_library_grow_cursors() {
  echo "-- source cursors --"
  grep -q 'rail_source_ingest_state' src/catalog-service/src/playability/db.ts
  grep -q 'ensureRailSourceIngestOffsets' src/catalog-service/src/playability/db.ts
  grep -q 'SourceCursorListSource' src/catalog-service/src/playability/list-source.ts
  grep -q 'sources_touched' src/catalog-service/src/playability/candidate-ingest.ts
  grep -q 'loadSourceOffsetsForListSource' src/catalog-service/src/playability/grow-rail.ts
  grep -q 'areAllSourcesExhausted' src/catalog-service/src/playability/candidate-ingest.ts
}

gate_library_grow_refresh_api() {
  echo "-- refresh API / presets --"
  grep -q 'grow_quick' src/catalog-service/src/playability/refresh-control.ts
  grep -q 'resolveRefreshLevelId' src/catalog-service/src/playability/refresh-control.ts
  grep -q 'startRefreshJob' src/catalog-service/src/playability/refresh-control.ts
  grep -q 'playability-grow.sh' scripts/m3-play/playability/playability-refresh-level.sh
  grep -q '\-\-preset' scripts/m3-play/playability/playability-indexer.ts
  grep -q 'startRefreshJob' src/catalog-service/src/index.ts
}

gate_library_grow_ops() {
  echo "-- ops SLA report --"
  test -f scripts/diag/ops_grow_sla.py
  test -f scripts/m3-play/playability/LIBRARY-GROWER-OPS.md
  grep -q 'Library Grower SLA' scripts/diag/ops-report.py
  grep -q 'summarize_grow_sla' scripts/diag/ops-report.py
  python3 scripts/diag/ops-report.py --date 2099-01-01 2>&1 | grep -q 'Library Grower SLA'
}

gate_library_grow_catalog_yaml() {
  echo "-- catalog grow_per_pass --"
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
}

gate_library_grow_maintenance() {
  echo "-- maintenance modes --"
  grep -q "export type RefreshMode = 'grow' | 'stale'" src/catalog-service/src/playability/grow-target.ts
  grep -q 'normalizeRefreshMode' src/catalog-service/src/playability/grow-target.ts
  grep -q '"nightly"' scripts/m3-play/playability/playability-maintenance.sh
  grep -q 'phase 1: stale refresh' scripts/m3-play/playability/playability-maintenance.sh
  grep -q '\-\-mode nightly' scripts/m3-play/playability/install-playability-timer.sh
  test -f scripts/m4-addons/sync-aiometadata-rail-catalogs.sh
}

gate_library_grow_fresh_quota() {
  echo "-- fresh-only grow quota --"
  test -f src/catalog-service/src/playability/grow-fresh-quota.test.ts
  grep -q 'fresh_verified' src/catalog-service/src/playability/grow-rail.ts
  grep -q 'freshVerifiedCount' src/catalog-service/src/playability/grow-rail.ts
  grep -q 'incrementGrowthPassFresh' src/catalog-service/src/playability/pipeline.ts
  grep -q 'incrementGrowthPassLinked' src/catalog-service/src/playability/pipeline.ts
  grep -q 'growLinkMaxPerRail' src/catalog-service/src/playability/config.ts
  grep -q 'MANGO_GROW_LINK_MAX' src/catalog-service/src/playability/config.ts
  ! grep -q 'incrementGrowthPassVerified(growthPass' src/catalog-service/src/playability/pipeline.ts
  grep -q '_fresh_verified' scripts/diag/ops_grow_sla.py
}

gate_library_grow_run() {
  gate_library_grow_repo
  gate_library_grow_header
  gate_library_grow_tests
  gate_library_grow_monitor
  gate_library_grow_entrypoints
  gate_library_grow_rail_impl
  gate_library_grow_compose
  gate_library_grow_cursors
  gate_library_grow_refresh_api
  gate_library_grow_ops
  gate_library_grow_fresh_quota
  gate_library_grow_catalog_yaml
  gate_library_grow_maintenance
  echo "N3c library grow gate ok"
}
