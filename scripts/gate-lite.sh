#!/usr/bin/env bash
# Quick deploy gate (~1–2 min). Per-rail play sweep: MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh

set -euo pipefail

export MANGO_REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=lib/gate-common.sh
source "$(cd "$(dirname "$0")" && pwd)/lib/gate-common.sh"
mango_gate_init

gate_header "mango gate-lite"
echo "full per-rail play: MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh"
echo

run_step() {
  local label="$1"
  shift
  if "$@"; then
    gate_pass "$label"
  else
    gate_fail "$label"
    return 1
  fi
}

run_step "N0 stack" bash scripts/phase-n0/gate-n0.sh

if [[ "${MANGO_CATALOG:-0}" != "1" ]]; then
  gate_finish "gate-lite" || exit 1
  exit 0
fi

curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
  && gate_pass "catalog /health" || { gate_fail "catalog /health"; exit 1; }

if [[ "${MANGO_SELF_HOSTED_ADDONS:-0}" == "1" || -f /etc/mango/aiostreams.enabled ]]; then
  run_step "N3d prereqs" bash scripts/phase-n3d/check-n3d-prereqs.sh
  run_step "N3d streams" bash scripts/phase-n3d/gate-n3d-streams.sh
  run_step "N3d stream language" bash scripts/phase-n3d/gate-n3d-stream-language.sh
  run_step "N3d catalogs" bash scripts/phase-n3d/gate-n3d-catalogs.sh
fi

run_step "N2 browse" bash scripts/phase-n2/gate-n2-browse.sh
run_step "N3b detail streams" bash scripts/phase-n3/gate-n3b-detail.sh
run_step "N3e episodes" bash scripts/phase-n3/gate-n3e-episodes.sh
run_step "catalog unit" bash scripts/gate-lite-unit.sh
run_step "N5b ai catalogs" bash scripts/phase-n5/gate-n5b-ai-catalogs.sh
run_step "lite play" bash scripts/gate-lite-play.sh

if [[ "${MANGO_VOICE:-}" == "1" ]]; then
  run_step "N5 voice tools" bash scripts/phase-n5/gate-voice-tools.sh
fi

gate_finish "gate-lite" || exit 1
