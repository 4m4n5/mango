#!/usr/bin/env bash
# Gate: Library Grower PR6 — ops report SLA section + tests.
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

echo "== gate-n3c-ops-sla =="

test -f scripts/diag/ops_grow_sla.py
test -f scripts/diag/test_ops_grow_sla.py
grep -q 'Library Grower SLA' scripts/diag/ops-report.py
grep -q 'summarize_grow_sla' scripts/diag/ops-report.py
test -f scripts/phase-n3c/LIBRARY-GROWER-OPS.md

python3 -m unittest discover -s scripts/diag -p 'test_ops_grow_sla.py' -v

python3 scripts/diag/ops-report.py --date 2099-01-01 2>&1 | grep -q 'Library Grower SLA'

echo "N3c ops SLA gate ok"
