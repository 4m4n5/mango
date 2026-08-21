#!/usr/bin/env bash
# Regression: watchdog must not pkill intentional pre-couch gates /play curls.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPAIR="$REPO_DIR/scripts/mango-health-repair.sh"

grep -q 'intentional_pre_couch_gate_active' "$REPAIR" \
  || { echo "FAIL: missing intentional_pre_couch_gate_active guard" >&2; exit 1; }

# The gate pkills must sit behind the intentional-gate / playback guards.
# In-flight /play curls must not be pkilled by the watchdog at all.
python3 - "$REPAIR" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text(encoding="utf-8")
start = text.index("kill_safe_strays()")
end = text.index("\nplayability_maintenance_active()", start)
body = text[start:end]
if "intentional_pre_couch_gate_active" not in body:
    raise SystemExit("FAIL: kill_safe_strays missing intentional gate guard")
if "playback_active" not in body:
    raise SystemExit("FAIL: kill_safe_strays missing playback_active guard")
if "pkill -f 'curl.*127" in body or "pkill -f 'curl.*127\\.0\\.0\\.1:3020/play'" in body:
    raise SystemExit("FAIL: watchdog still pkills in-flight /play curls")
gate_idx = body.find("pkill -f 'gate-m3-verified-rails'")
guard_idx = body.find("intentional_pre_couch_gate_active")
if gate_idx < 0:
    raise SystemExit("FAIL: expected orphan gate pkills still present")
if not (0 <= guard_idx < gate_idx):
    raise SystemExit("FAIL: gate pkills are not guarded by intentional_pre_couch_gate_active")
print("PASS: health-repair preserves intentional gates and /play curls")
PY
