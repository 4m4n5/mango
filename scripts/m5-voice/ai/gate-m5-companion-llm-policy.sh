#!/usr/bin/env bash
# N5c nightly LLM policy gate — JSON parse only (no API).
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$REPO_DIR/src/orchestrator"
# shellcheck disable=SC1091
source .venv/bin/activate
python3 -m unittest tests.test_companion_llm -v
echo "PASS: N5c companion LLM parse tests"
