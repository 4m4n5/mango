#!/usr/bin/env bash
# Download Piper voice model into piper_data_dir (once per machine).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ORCH_DIR="$REPO_DIR/src/orchestrator"
VENV="$ORCH_DIR/.venv"
VOICE="${MANGO_PIPER_VOICE:-en_US-lessac-medium}"
DATA_DIR="${MANGO_PIPER_DATA_DIR:-$HOME/.local/share/piper}"

if [[ ! -d "$VENV" ]]; then
  echo "Run: bash scripts/m5-voice/stack/install-orchestrator-deps.sh" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m piper.download_voices "$VOICE" --data-dir "$DATA_DIR"
echo "✓ Piper voice $VOICE in $DATA_DIR"
