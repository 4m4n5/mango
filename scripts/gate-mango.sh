#!/usr/bin/env bash
# Single dispatcher for Mango gates. Existing scripts stay as aliases.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-}"
if [[ "$MODE" == "--lite" || "$MODE" == "--full" || "$MODE" == "--m6-only" || "$MODE" == "--pr" ]]; then
  shift
else
  MODE="--lite"
fi

case "$MODE" in
  --pr)
    exec bash "$ROOT/scripts/mac-gate-pr.sh" "$@"
    ;;
  --lite)
    exec bash "$ROOT/scripts/gate-lite.sh" "$@"
    ;;
  --full)
    export MANGO_GATE_FULL=1
    exec bash "$ROOT/scripts/pi-pre-couch-gate.sh" "$@"
    ;;
  --m6-only)
    exec bash "$ROOT/scripts/pi-pre-couch-gate.sh" "$@"
    ;;
  *)
    echo "usage: bash scripts/gate-mango.sh [--pr|--lite|--full|--m6-only]" >&2
    exit 2
    ;;
esac
