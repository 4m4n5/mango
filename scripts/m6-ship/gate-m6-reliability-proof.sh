#!/usr/bin/env bash
# Pi gate for Mango Reliability Center. Fails only when couch availability is red.

set -uo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR" || exit 1

# shellcheck source=../lib/gate-common.sh
source "$REPO_DIR/scripts/lib/gate-common.sh"
mango_gate_init
gate_header "M6 Reliability Proof"

CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
out="$(mktemp)"
trap 'rm -f "$out"' EXIT

if curl -sf --max-time 5 "$CATALOG/health" >/dev/null 2>&1; then
  gate_pass "catalog /health"
else
  gate_fail "catalog /health"
  gate_finish "gate-m6-reliability-proof"
  exit $?
fi

body='{"reason":"gate_m6_reliability"}'
if curl -sS --fail --max-time 35 \
  -H 'content-type: application/json' \
  -d "$body" \
  "$CATALOG/reliability/proof/run" >"$out"; then
  gate_pass "POST /reliability/proof/run"
else
  gate_fail "POST /reliability/proof/run"
  gate_finish "gate-m6-reliability-proof"
  exit $?
fi

python3 - "$out" <<'PY' || gate_fail "reliability proof red"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
proof = payload.get("proof") or {}
state = payload.get("state") or {}
status = proof.get("status") or state.get("status")
print(f"reliability: {status} — {proof.get('summary') or state.get('summary')}")
if status not in {"green", "yellow", "red"}:
    raise SystemExit(f"unknown reliability status: {status}")
for component in state.get("components") or proof.get("components") or []:
    if component.get("status") != "green":
        print(f"  {component.get('status')}: {component.get('label')} — {component.get('summary')}")
if status == "red":
    raise SystemExit(1)
PY

if python3 - "$out" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
status = (payload.get("proof") or payload.get("state") or {}).get("status")
raise SystemExit(0 if status == "yellow" else 1)
PY
then
  gate_warn "reliability proof yellow"
else
  gate_pass "reliability proof green"
fi

gate_finish "gate-m6-reliability-proof"
