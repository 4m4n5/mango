#!/usr/bin/env bash
# N3d aggregate gate — self-hosted addon stack plus idle hygiene.

set -euo pipefail

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init

gate_header "mango N3d self-hosted addon gate"

run_gate() {
  local label="$1"
  shift
  if "$@"; then
    gate_pass "$label"
  else
    gate_fail "$label"
  fi
}

run_gate "N3d prereqs" bash scripts/phase-n3d/check-n3d-prereqs.sh
run_gate "N3d streams" bash scripts/phase-n3d/gate-n3d-streams.sh
run_gate "N3d catalogs" bash scripts/phase-n3d/gate-n3d-catalogs.sh
gate_idle_hygiene

gate_finish "N3d self-hosted gate"
