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

run_step "M1 foundation" bash scripts/m1-foundation/gate/gate-m1.sh

if [[ "${MANGO_CATALOG:-0}" != "1" ]]; then
  gate_finish "gate-lite" || exit 1
  exit 0
fi

curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
  && gate_pass "catalog /health" || { gate_fail "catalog /health"; exit 1; }

if [[ "${MANGO_SELF_HOSTED_ADDONS:-0}" == "1" || -f /etc/mango/aiostreams.enabled ]]; then
  run_step "M4 addons prereqs" bash scripts/m4-addons/check-m4-prereqs.sh
  run_step "M4 streams" bash scripts/m4-addons/gate-m4-streams.sh
  run_step "M4 stream language" bash scripts/m4-addons/gate-m4-stream-language.sh
  run_step "M4 catalogs" bash scripts/m4-addons/gate-m4-catalogs.sh
fi

run_step "M2 browse" bash scripts/m2-catalog/browse/gate-m2-browse.sh
run_step "M3 detail streams" bash scripts/m3-play/detail/gate-m3-detail.sh
run_step "M3 episodes" bash scripts/m3-play/detail/gate-m3-episodes.sh
run_step "catalog unit" bash scripts/gate-lite-unit.sh
run_step "M5 ai catalogs" bash scripts/m5-voice/ai/gate-m5-ai-catalogs.sh
run_step "M5 ai bootstrap" bash scripts/m5-voice/ai/gate-m5-ai-bootstrap.sh
run_step "M5 mdblist reserve" bash scripts/m5-voice/ai/gate-m5-mdblist-reserve.sh
run_step "lite play" bash scripts/gate-lite-play.sh

if [[ "${MANGO_VOICE:-}" == "1" ]]; then
  run_step "M5 voice tools" bash scripts/m5-voice/ai/gate-m5-voice.sh
  run_step "M5 conversation" bash scripts/m5-voice/ai/gate-m5-conversation-policy.sh
  run_step "M5 companion memory" bash scripts/m5-voice/ai/gate-m5-companion-memory.sh
  run_step "M5 gardener" bash scripts/m5-voice/ai/gate-m5-gardener.sh
  run_step "M5 LLM policy" bash scripts/m5-voice/ai/gate-m5-companion-llm-policy.sh
fi

gate_finish "gate-lite" || exit 1
