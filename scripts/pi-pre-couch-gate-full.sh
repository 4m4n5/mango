#!/usr/bin/env bash
# Full pre-couch gate — per-rail play samples (slow). Prefer gate-lite for deploy iteration.

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

bash scripts/phase-n0/gate-n0.sh

if [[ "${MANGO_CATALOG:-0}" == "1" ]]; then
  curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
    || { echo "FAIL: catalog down — bash scripts/mango-refresh.sh" >&2; exit 1; }
  if [[ "${MANGO_SELF_HOSTED_ADDONS:-0}" == "1" || -f /etc/mango/aiostreams.enabled ]]; then
    bash scripts/phase-n3d/gate-n3d-self-hosted.sh
  fi
  if [[ -x scripts/phase-n3c/gate-n3c-verified-rails.sh ]]; then
    bash scripts/phase-n3c/gate-n3c-verified-rails.sh
  fi
  if [[ -x scripts/phase-n3a/gate-n3a-play.sh ]]; then
    bash scripts/phase-n3a/gate-n3a-play.sh
  fi
fi

gate_finish "PRE-COUCH FULL" || exit 1
