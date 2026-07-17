#!/usr/bin/env bash
# Regression: mango_gate_init must export MANGO_REPO_DIR under set -u.
# gate_idle_hygiene previously referenced unbound $MANGO_REPO_DIR when callers
# only set REPO_DIR (full pre-couch / gate-m1 path).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Simulate full-gate callers that do not export MANGO_REPO_DIR first.
unset MANGO_REPO_DIR || true

# shellcheck source=gate-common.sh
source "$SCRIPT_DIR/gate-common.sh"
mango_gate_init

if [[ -z "${MANGO_REPO_DIR:-}" ]]; then
  echo "FAIL: mango_gate_init left MANGO_REPO_DIR unset" >&2
  exit 1
fi
if [[ "$MANGO_REPO_DIR" != "$REPO_DIR" ]]; then
  echo "FAIL: MANGO_REPO_DIR ($MANGO_REPO_DIR) != REPO_DIR ($REPO_DIR)" >&2
  exit 1
fi
if [[ ! -x "$MANGO_REPO_DIR/scripts/m1-foundation/pad/pad-health.sh" ]]; then
  echo "FAIL: expected pad-health under exported MANGO_REPO_DIR" >&2
  exit 1
fi

# Under set -u this must not abort the way full gate did before the fix.
pad_repo="${MANGO_REPO_DIR:-${REPO_DIR:-}}"
[[ -n "$pad_repo" ]] || {
  echo "FAIL: pad_repo empty" >&2
  exit 1
}

# gate_wait_catalog_ready must exist for lite-play settle (may fail off-Pi).
type gate_wait_catalog_ready >/dev/null 2>&1 || {
  echo "FAIL: gate_wait_catalog_ready missing" >&2
  exit 1
}

echo "PASS: mango_gate_init exports MANGO_REPO_DIR ($MANGO_REPO_DIR)"
