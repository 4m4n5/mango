#!/usr/bin/env bash
# N3 play hit-rate gate — 10 random catalog picks must mostly play.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

SAMPLE="${MANGO_HITRATE_SAMPLE:-10}"
SEED="${MANGO_HITRATE_SEED:-$RANDOM}"
MIN_OK="${MANGO_HITRATE_MIN_OK:-8}"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

trap 'bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true' EXIT

echo "========== mango N3 hit-rate gate $(date -Iseconds) =========="
echo "sample=$SAMPLE seed=$SEED min_ok=$MIN_OK"

if ! python3 scripts/diag/batch-play-hitrate.py "$SAMPLE" "$SEED"; then
  echo "N3 hit-rate gate: FAIL (play_ok < ${MIN_OK}/${SAMPLE})" >&2
  exit 1
fi

echo "N3 hit-rate gate: PASS"
