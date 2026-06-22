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

run_gate "M4 prereqs" bash scripts/m4-addons/check-m4-prereqs.sh
run_gate "M4 streams" bash scripts/m4-addons/gate-m4-streams.sh
run_gate "M4 stream language" bash scripts/m4-addons/gate-m4-stream-language.sh
run_gate "M4 catalogs" bash scripts/m4-addons/gate-m4-catalogs.sh
gate_idle_hygiene

gate_finish "M4 self-hosted gate"
