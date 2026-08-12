#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
export MANGO_REPO_DIR="$REPO_DIR"
export XDG_CACHE_HOME="$TMP_DIR/cache"
export MANGO_PLAYABILITY_COORDINATOR_TEST_ONLY=1

bash "$REPO_DIR/scripts/m3-play/playability/playability-grow.sh" --mode grow --preset nightly >/dev/null
bash "$REPO_DIR/scripts/m3-play/playability/nightly-library-refresh.sh" --mode nightly --preset nightly >/dev/null
bash "$REPO_DIR/scripts/m3-play/playability/playability-maintenance.sh" --mode stale >/dev/null

python3 - "$XDG_CACHE_HOME/mango/playability-runs" <<'PY'
import json
import sys
from pathlib import Path

runs = Path(sys.argv[1])
receipts = [
    json.loads(path.read_text(encoding="utf-8"))
    for path in runs.glob("*.json")
    if path.name != "active.json" and not path.name.endswith(".claim.json")
]
levels = {receipt.get("level") for receipt in receipts}
expected = {"grow_standard", "grow_nightly", "stale_refresh"}
if levels != expected:
    raise SystemExit(f"unexpected coordinated levels: {levels} expected={expected}")
if any(receipt.get("state") != "succeeded" for receipt in receipts):
    raise SystemExit(f"non-terminal coordinator receipt: {receipts}")
PY

echo "PASS: familiar playability entrypoints delegate before side effects"
