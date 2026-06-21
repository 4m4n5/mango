#!/usr/bin/env bash
# Nightly companion pipeline — rule → optional Sonnet LLM → gardener.
# Cron: 0 3 * * * cd ~/mango && bash scripts/phase-n5/companion-nightly-consolidate.sh
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
CATALOG="${MANGO_CATALOG_UPSTREAM:-http://127.0.0.1:3020}"
cd "$REPO_DIR"

bash "$REPO_DIR/scripts/phase-n5/sync-companion-example.sh" || true

echo "=== Phase 1: rule consolidate ==="
RULE="$(curl -sf --max-time 30 -X POST "$CATALOG/voice/companion/consolidate" \
  -H 'content-type: application/json' -d '{}' || true)"
echo "$RULE" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True' \
  || { echo "FAIL: rule consolidate" >&2; echo "$RULE" >&2; exit 1; }
echo "PASS: rule consolidate"

if [[ "${MANGO_COMPANION_LLM_NIGHTLY:-1}" == "1" ]] && [[ -f /etc/mango/llm.key || -n "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "=== Phase 2: Sonnet LLM consolidate (optional) ==="
  if [[ -d src/orchestrator/.venv ]]; then
    (
      cd src/orchestrator
      # shellcheck disable=SC1091
      source .venv/bin/activate
      python3 "$REPO_DIR/scripts/phase-n5/companion-nightly-llm.py"
    ) || echo "WARN: LLM nightly skipped/failed — continuing with gardener"
  else
    echo "WARN: orchestrator venv missing — skip LLM nightly"
  fi
else
  echo "SKIP: LLM nightly (MANGO_COMPANION_LLM_NIGHTLY=0 or no API key)"
fi

echo "=== Phase 3: catalog gardener ==="
GARDEN="$(curl -sf --max-time 30 -X POST "$CATALOG/voice/companion/gardener" \
  -H 'content-type: application/json' -d '{}' || true)"
echo "$GARDEN" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True' \
  || { echo "FAIL: gardener" >&2; echo "$GARDEN" >&2; exit 1; }
echo "PASS: gardener"
echo "$GARDEN"
echo "PASS: companion nightly pipeline complete"
