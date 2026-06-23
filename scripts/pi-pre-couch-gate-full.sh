#!/usr/bin/env bash
# Full pre-couch gate — holistic M1/M4 + sampled per-rail play (3/rail default).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

# shellcheck source=lib/gate-common.sh
source "$REPO_DIR/scripts/lib/gate-common.sh"
mango_gate_init

gate_header "mango pre-couch gate (full)"
echo "tip: default deploy uses scripts/gate-lite.sh"
echo

bash scripts/m1-foundation/gate/gate-m1.sh

if [[ "${MANGO_CATALOG:-0}" == "1" ]]; then
  curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
    || { echo "FAIL: catalog down — bash scripts/mango-refresh.sh" >&2; exit 1; }
  if [[ "${MANGO_SELF_HOSTED_ADDONS:-0}" == "1" || -f /etc/mango/aiostreams.enabled ]]; then
    bash scripts/m4-addons/gate-m4-self-hosted.sh
  fi
  if [[ -x scripts/m3-play/playability/gate-m3-verified-rails.sh ]]; then
    bash scripts/m3-play/playability/gate-m3-verified-rails.sh
  fi
  if [[ -x scripts/m3-play/orchestrator/gate-m3-play.sh ]]; then
    bash scripts/m3-play/orchestrator/gate-m3-play.sh
  fi
fi

gate_finish "PRE-COUCH FULL" || exit 1
