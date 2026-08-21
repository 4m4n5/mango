#!/usr/bin/env bash
# Record a Mango Reliability Center proof through catalog-service.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
REASON="manual"
TIMEOUT_SEC="${MANGO_RELIABILITY_PROOF_TIMEOUT_SEC:-30}"
PLAYABILITY_RC=""
YOUTUBE_RC=""

usage() {
  cat <<EOF
usage: $0 [--reason <reason>] [--playability-rc <rc>] [--youtube-rc <rc>] [--timeout-sec <seconds>]

Records one local proof in /etc/mango/reliability via POST /reliability/proof/run.
Exits non-zero only when the proof is red or the API is unreachable.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason) REASON="${2:-manual}"; shift 2 ;;
    --playability-rc) PLAYABILITY_RC="${2:-}"; shift 2 ;;
    --youtube-rc) YOUTUBE_RC="${2:-}"; shift 2 ;;
    --timeout-sec) TIMEOUT_SEC="${2:-30}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

cd "$REPO_DIR"

if ! curl -sf --max-time 5 "$CATALOG/health" >/dev/null 2>&1; then
  echo "reliability proof: catalog-service unavailable at $CATALOG" >&2
  exit 1
fi

body="$(python3 - "$REASON" "$PLAYABILITY_RC" "$YOUTUBE_RC" <<'PY'
import json
import sys

reason = sys.argv[1].strip() or "manual"
metadata = {}
if sys.argv[2] != "":
    metadata["playability_rc"] = int(sys.argv[2])
if sys.argv[3] != "":
    metadata["youtube_rc"] = int(sys.argv[3])
print(json.dumps({"reason": reason, "metadata": metadata}, separators=(",", ":")))
PY
)"

out="$(mktemp)"
trap 'rm -f "$out"' EXIT

if ! curl -sS --fail --max-time "$TIMEOUT_SEC" \
  -H 'content-type: application/json' \
  -d "$body" \
  "$CATALOG/reliability/proof/run" >"$out"; then
  echo "reliability proof: POST /reliability/proof/run failed" >&2
  exit 1
fi

python3 - "$out" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

proof = payload.get("proof") or {}
state = payload.get("state") or {}
status = proof.get("status") or state.get("status") or "unknown"
summary = proof.get("summary") or state.get("summary") or "unknown"
proof_id = proof.get("proof_id") or "unknown"
print(f"reliability proof: status={status} proof_id={proof_id} summary={summary}")
if status not in {"green", "yellow", "red"}:
    raise SystemExit(f"unknown reliability status: {status}")
for component in state.get("components") or proof.get("components") or []:
    comp_status = component.get("status")
    if comp_status != "green":
        print(f"reliability proof: {comp_status} {component.get('label')}: {component.get('summary')}")
if status == "red":
    raise SystemExit(1)
PY
