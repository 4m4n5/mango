#!/usr/bin/env bash
# Install Python deps for orchestrator (once per machine).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ORCH_DIR="$REPO_DIR/src/orchestrator"
VENV="$ORCH_DIR/.venv"

cd "$ORCH_DIR"
python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --upgrade pip
pip install -r requirements.txt
echo "→ System audio deps: bash scripts/phase2/install-voice-deps.sh"
echo "✓ orchestrator venv ready — bash scripts/phase2/start-orchestrator.sh"
