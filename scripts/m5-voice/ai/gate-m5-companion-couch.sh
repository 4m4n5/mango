#!/usr/bin/env bash
# M5.5a companion couch gate — mock paths only (no LLM API).
# Usage: bash scripts/m5-voice/ai/gate-m5-companion-couch.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$REPO_DIR"

if [[ ! -d src/orchestrator/.venv ]]; then
  echo "FAIL: orchestrator venv missing — run scripts/m5-voice/stack/ensure-orchestrator-venv.sh" >&2
  exit 1
fi

echo "== companion couch gate (mock) =="

(
  cd src/orchestrator
  # shellcheck disable=SC1091
  source .venv/bin/activate
  python3 -m unittest \
    tests.test_companion_corpus \
    tests.test_open_intent_discover \
    tests.test_voice_nav \
    tests.test_chat_send \
    tests.test_guard_open_claims \
    tests.test_couch_safe \
    tests.test_tool_summary \
    -v
)

# Fixture files must parse as JSON arrays.
python3 - <<'PY'
import json
from pathlib import Path

root = Path("scripts/m5-voice/ai/fixtures")
for name in ("companion-corpus-en.json", "companion-corpus-hinglish.json"):
    path = root / name
    data = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(data, list) and data, f"{name} must be a non-empty JSON array"
    for row in data:
        assert "id" in row and "utterance" in row and "expect" in row, f"{name}: bad row {row}"
print("PASS: companion corpus fixtures")
PY

echo "PASS: M5.5a companion couch gate (mock paths)"
