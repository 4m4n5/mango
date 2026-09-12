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
  local cache_dir="${MANGO_TEST_XDG_CACHE_HOME:-${TMPDIR:-/tmp}/mango-catalog-test-cache}"
  mkdir -p "$cache_dir"
  XDG_CACHE_HOME="$cache_dir" npm --prefix src/catalog-service run test 2>&1 | tail -12
}

gate_library_grow_monitor() {
  echo "-- grow monitor --"
  test -f scripts/diag/grow_monitor.py
  test -f scripts/diag/test_grow_monitor.py
  python3 scripts/diag/grow_monitor.py --help >/dev/null
  python3 -m unittest discover -s scripts/diag -p 'test_grow_monitor.py' -v
  python3 -m unittest discover -s scripts/diag -p 'test_ops_grow_sla.py' -v
  python3 -m unittest discover -s scripts/diag -p 'test_playability_refresh_decision.py' -v
  python3 -m unittest discover -s scripts/diag -p 'test_recommendation_maintenance_lease.py' -v
  python3 -m unittest discover -s scripts/diag -p 'test_recommendation_refresh_receipt.py' -v
}

gate_library_grow_entrypoints() {
  echo "-- entrypoints --"
  test -x scripts/m3-play/playability/playability-grow.sh
  test -x scripts/m3-play/playability/grow-run-control.sh
  bash scripts/m3-play/playability/playability-grow.sh --help >/dev/null
  bash scripts/m3-play/playability/grow-run-control.sh status --help >/dev/null
  grep -q 'grow_monitor.py' scripts/m3-play/playability/playability-grow.sh
  grep -q 'abort-maintenance-grow.sh' scripts/m3-play/playability/grow-run-control.sh
  grep -q 'grow_monitor.py' scripts/m3-play/playability/playability-maintenance.sh
  python3 scripts/diag/source-grow-audit.py --help >/dev/null
  grep -q 'list_grow_rail_ids' scripts/diag/ops_grow_sla.py
  grep -q 'railsForGrowPass' src/catalog-service/src/playability/refresh.ts
  grep -q 'flushVerifyContextBatch' src/catalog-service/src/playability/grow-rail.ts
  grep -q 'growDeepPageBypassReasons' src/catalog-service/src/playability/grow-rail.ts
  grep -q 'MANGO_GROW_BYPASS_RECENT_FAILED' src/catalog-service/src/playability/grow-tombstones.ts
  grep -q 'MANGO_GROW_NO_STREAM_RETRY_MS.*604800000' scripts/m3-play/playability/playability-maintenance.sh
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
rails = {rail.get("id"): rail for rail in catalog.get("rails") or []}
for rail in catalog.get("rails") or []:
    if rail.get("enabled") is False:
        continue
    if rail.get("type") not in {"addon_catalog", "composite_list"}:
        continue
    play = rail.get("playability") or {}
    assert play.get("grow_per_pass", 0) >= 20, f"{rail['id']} missing grow_per_pass"
    assert "growth_quota" not in play, f"{rail['id']} still has growth_quota"
    assert "growth_attempt_budget" not in play, f"{rail['id']} still has growth_attempt_budget"
series_india = rails["series-india-picks"]
sources = series_india["sources"]
latest_head = [source["catalog"] for source in sources[:10]]
assert latest_head == [
    "tmdb-hi-recent-series",
    "tmdb-hi-latest_episodes-series",
    "tmdb-ta-recent-series",
    "tmdb-ta-latest_episodes-series",
    "tmdb-te-recent-series",
    "tmdb-te-latest_episodes-series",
    "tmdb-ml-recent-series",
    "tmdb-ml-latest_episodes-series",
    "tmdb-kn-recent-series",
    "tmdb-kn-latest_episodes-series",
], f"series-india-picks should prioritize existing recent/latest feeds first: {latest_head}"
active_recent = [
    source for source in sources[:6]
    if str(source.get("catalog", "")).endswith("-recent-series")
    and float(source.get("weight", 0)) > 0.08
]
assert len(active_recent) == 3, "series-india-picks primary healthy recent feeds must stay above probation"
probation_latest = [
    source for source in sources[:10]
    if "latest_episodes" in str(source.get("catalog", ""))
    and float(source.get("weight", 0)) <= 0.01
]
assert len(probation_latest) == 5, "empty latest-episode feeds must not consume active discovery budget"
for rail_id, index in (("movies-global-popular", 1), ("movies-quick-watches", 0)):
    source = rails[rail_id]["sources"][index]
    assert source["addon"] == "Cinemeta" and source["catalog"] == "year", (
        f"{rail_id} should keep verified recent-year Cinemeta source ahead of old breadth"
    )
    assert float(source.get("weight", 0)) > 0.08, (
        f"{rail_id} Cinemeta/year must stay above probation"
    )
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
  grep -q 'MANGO_GROW_PRESET.*quick' scripts/m3-play/playability/playability-maintenance.sh
  grep -q 'MANGO_PLAYABILITY_ADMISSION_DEADLINE_MS.*8 \* 60' scripts/m3-play/playability/playability-maintenance.sh
  grep -q 'MANGO_STATE_BACKUP_ON_STOP=0' scripts/m3-play/playability/playability-maintenance.sh
  bash scripts/m3-play/playability/test-maintenance-catalog-filters.sh
  bash scripts/m3-play/playability/test-wait-vod-recommendation-jobs.sh
  bash scripts/m3-play/playability/test-coordinator-entrypoints.sh
  bash scripts/m4-addons/test-aiometadata-opt-in-and-temp.sh
  bash scripts/m6-ship/test-youtube-pot-server-fd.sh
  bash scripts/m6-ship/test-library-offline-compaction.sh
  python3 scripts/m6-ship/test_prune_mango_sqlite.py
  python3 scripts/m6-ship/test_restore_expiry_only_visibility.py
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
  grep -q 'fetch_unique_verified_library_count' scripts/diag/grow_monitor.py
  grep -q 'getUniqueVerifiedLibraryCount' src/catalog-service/src/playability/db.ts
  grep -q 'unique_verified_delta' src/catalog-service/src/playability/refresh.ts
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
