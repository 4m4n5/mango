#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

STAMP="$TMP/compaction.last"
MARKER="$TMP/compactor.marker"

cat >"$TMP/fake-compactor.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
python3 - "$TEST_COMPACTOR_MARKER" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
count = 0
if path.is_file():
    count = int(path.read_text(encoding="utf-8").strip() or "0")
path.write_text(f"{count + 1}\n", encoding="utf-8")
PY
SH
chmod +x "$TMP/fake-compactor.sh"

export TEST_COMPACTOR_MARKER="$MARKER"
export MANGO_REPO_DIR="$ROOT"
export XDG_CACHE_HOME="$TMP/cache"
export MANGO_LIBRARY_COMPACTION_STAMP="$STAMP"
export MANGO_LIBRARY_COMPACTION_MIN_HOURS=100
export MANGO_LIBRARY_COMPACTION_SCRIPT="$TMP/fake-compactor.sh"
export MANGO_LIBRARY_COMPACTION_IGNORE_COUCH_ACTIVITY=1
export MANGO_LIBRARY_COMPACTION_IGNORE_RECOMMENDATION_LEASE=1
export MANGO_LIBRARY_COMPACTION_IGNORE_MAINTENANCE_LOCK=1

bash "$ROOT/scripts/m6-ship/library-offline-compaction.sh" >/dev/null
first_count="$(python3 - "$MARKER" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).read_text(encoding="utf-8").strip())
PY
)"
[[ "$first_count" == "1" ]]

if bash "$ROOT/scripts/m6-ship/library-offline-compaction.sh" >/dev/null 2>&1; then
  echo "second compaction run should have been cooldown-gated" >&2
  exit 1
fi

bash "$ROOT/scripts/m6-ship/library-offline-compaction.sh" --force >/dev/null
second_count="$(python3 - "$MARKER" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).read_text(encoding="utf-8").strip())
PY
)"
[[ "$second_count" == "2" ]]

PRUNE_SOURCE="$ROOT/scripts/m6-ship/prune-mango-state.sh"
grep -q 'backup-library-state.sh.*--quiet' "$PRUNE_SOURCE"
grep -q 'systemctl --user stop mango-vod-recs-worker.service' "$PRUNE_SOURCE"
grep -q 'vod-recs-worker.lease' "$PRUNE_SOURCE"
grep -q 'PRAGMA quick_check' "$PRUNE_SOURCE"
grep -q 'systemctl --user start mango-vod-recs-worker.service' "$PRUNE_SOURCE"

echo "PASS: offline compaction hook enforces cooldown and force override"
