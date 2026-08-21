#!/usr/bin/env bash
# P0 pool geometry — legacy prune + targeted top-up on thin thematic rails.
#
#   bash scripts/m3-play/playability/pool-geometry-p0.sh dry-run
#   bash scripts/m3-play/playability/pool-geometry-p0.sh apply [--skip-topup]
#
# apply: prune legacy pools, then top-up rails below 50% pool_target (maintenance window).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
export MANGO_REPO_DIR="$REPO_DIR"
cd "$REPO_DIR"

MODE="${1:-}"
shift || true
SKIP_TOPUP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-topup) SKIP_TOPUP=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ "$MODE" == "dry-run" || "$MODE" == "apply" ]] || {
  echo "usage: $0 dry-run|apply [--skip-topup]" >&2
  exit 2
}

echo "=== pool geometry P0 ($MODE) ==="
bash scripts/m3-play/playability/rail-pool-legacy-prune.sh "$MODE"

if [[ "$MODE" == "dry-run" || "$SKIP_TOPUP" -eq 1 ]]; then
  echo "thin rails (would top-up on apply):"
  python3 - "$REPO_DIR" <<'PY'
import os, sqlite3, sys, time
from pathlib import Path

repo = Path(sys.argv[1])
catalog = Path(os.environ.get("MANGO_CATALOG_YAML", "/etc/mango/catalog.yaml"))
db = Path(os.environ.get("MANGO_PLAYABILITY_DB", "/etc/mango/playability.db"))
try:
    import yaml
except ImportError:
  yaml = None

THIN_RATIO = 0.5
grow_ids = []
targets = {}
if yaml and catalog.is_file():
    data = yaml.safe_load(catalog.read_text()) or {}
    for rail in data.get("rails") or []:
        if rail.get("enabled") is False:
            continue
        if rail.get("type") not in {"addon_catalog", "composite_list"}:
            continue
        rid = str(rail["id"])
        grow_ids.append(rid)
        play = rail.get("playability") or {}
        targets[rid] = int(play.get("pool_target") or 20)

now = int(time.time() * 1000)
counts = {}
if db.is_file():
    conn = sqlite3.connect(db)
    try:
        rows = conn.execute(
            """
            SELECT rp.rail_id, COUNT(*) FROM rail_pool rp
            JOIN titles t ON t.type=rp.type AND t.id=rp.id
            WHERE t.status='verified' AND (t.expires_at IS NULL OR t.expires_at>?)
            GROUP BY rp.rail_id
            """,
            (now,),
        ).fetchall()
        counts = {str(r): int(c) for r, c in rows}
    finally:
        conn.close()

thin = []
for rid in grow_ids:
    target = targets.get(rid, 20)
    verified = counts.get(rid, 0)
    ratio = verified / max(1, target)
    if ratio < THIN_RATIO:
        thin.append((ratio, rid, verified, target))
for ratio, rid, verified, target in sorted(thin):
    print(f"  {rid}: {verified}/{target} ({int(ratio*100)}%)")
if not thin:
    print("  (none)")
PY
  exit 0
fi

echo "=== targeted top-up (thin rails) ==="
THIN_RAILS="$(python3 - "$REPO_DIR" <<'PY'
import os, sqlite3, sys, time
from pathlib import Path

repo = Path(sys.argv[1])
catalog = Path(os.environ.get("MANGO_CATALOG_YAML", "/etc/mango/catalog.yaml"))
db = Path(os.environ.get("MANGO_PLAYABILITY_DB", "/etc/mango/playability.db"))
import yaml

THIN_RATIO = 0.5
ANCHORS = {"movies-global-popular", "series-global-popular"}
grow_ids = []
targets = {}
data = yaml.safe_load(catalog.read_text()) or {}
for rail in data.get("rails") or []:
    if rail.get("enabled") is False:
        continue
    if rail.get("type") not in {"addon_catalog", "composite_list"}:
        continue
    rid = str(rail["id"])
    if rid in ANCHORS:
        continue
    grow_ids.append(rid)
    play = rail.get("playability") or {}
    targets[rid] = int(play.get("pool_target") or 20)

now = int(time.time() * 1000)
counts = {}
conn = sqlite3.connect(db)
try:
    rows = conn.execute(
        """
        SELECT rp.rail_id, COUNT(*) FROM rail_pool rp
        JOIN titles t ON t.type=rp.type AND t.id=rp.id
        WHERE t.status='verified' AND (t.expires_at IS NULL OR t.expires_at>?)
        GROUP BY rp.rail_id
        """,
        (now,),
    ).fetchall()
    counts = {str(r): int(c) for r, c in rows}
finally:
    conn.close()

thin = []
for rid in grow_ids:
    target = targets.get(rid, 20)
    verified = counts.get(rid, 0)
    if verified / max(1, target) < THIN_RATIO:
        thin.append(rid)
print(" ".join(thin))
PY
)"

for rail in $THIN_RAILS; do
  echo "--- top-up: $rail ---"
  bash scripts/m3-play/playability/playability-top-up-rail.sh "$rail" || {
    echo "warn: top-up failed for $rail — continuing" >&2
  }
done

python3 scripts/diag/grow_monitor.py baseline
python3 scripts/diag/grow_monitor.py status
echo "pool geometry P0 apply complete"
