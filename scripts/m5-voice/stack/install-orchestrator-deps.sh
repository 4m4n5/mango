#!/usr/bin/env bash
# Install Python deps for orchestrator (once per machine).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/ensure-orchestrator-venv.sh"
echo "→ System audio deps: bash scripts/m5-voice/stack/install-voice-deps.sh"
echo "✓ orchestrator venv ready — bash scripts/m5-voice/stack/start-orchestrator.sh"
