#!/usr/bin/env bash
# N5c conversation policy gate — open_intent + open guard (no LLM API).
# Usage: bash scripts/m5-voice/ai/gate-m5-conversation-policy.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$REPO_DIR"

if [[ ! -d src/orchestrator/.venv ]]; then
  echo "FAIL: orchestrator venv missing — run scripts/m5-voice/stack/ensure-orchestrator-venv.sh" >&2
  exit 1
fi

(
  cd src/orchestrator
  # shellcheck disable=SC1091
  source .venv/bin/activate
  python3 -m unittest tests.test_voice_nav tests.test_open_intent_discover -v
)

echo "PASS: N5c conversation policy unit tests"
