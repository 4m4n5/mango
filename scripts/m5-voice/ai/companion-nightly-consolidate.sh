#!/usr/bin/env bash
# Nightly companion pipeline — rule → optional Sonnet LLM → gardener → migrate empty AI slots.
# Timer: bash scripts/m5-voice/ai/install-companion-nightly-timer.sh (04:30 daily)
# Cron fallback: 30 4 * * * cd ~/mango && bash scripts/m5-voice/ai/companion-nightly-consolidate.sh
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
CATALOG="${MANGO_CATALOG_UPSTREAM:-http://127.0.0.1:3020}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
OPS_DIR="${CACHE_DIR}/ops"
RUN_ID="companion-$(date +%Y%m%d-%H%M%S)"
export MANGO_OPS_RUN_ID="$RUN_ID"
NIGHTLY_LOG="${OPS_DIR}/companion-nightly-${RUN_ID}.log"
mkdir -p "$OPS_DIR"
exec > >(tee -a "$NIGHTLY_LOG") 2>&1

cd "$REPO_DIR"

log_ops() {
  local kind="$1"
  local summary="$2"
  local payload_file="$3"
  python3 "$REPO_DIR/scripts/diag/ops-write-run.py" \
    --kind "$kind" \
    --run-id "$RUN_ID" \
    --source companion-nightly \
    --summary "$summary" \
    --payload-file "$payload_file"
}

bash "$REPO_DIR/scripts/m5-voice/ai/sync-companion-example.sh" || true

echo "=== Phase 1: rule consolidate ==="
RULE="$(curl -sf --max-time 30 -X POST "$CATALOG/voice/companion/consolidate" \
  -H 'content-type: application/json' -d '{}' || true)"
echo "$RULE" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True' \
  || { echo "FAIL: rule consolidate" >&2; echo "$RULE" >&2; exit 1; }
echo "PASS: rule consolidate"
RULE_OUT="${OPS_DIR}/companion-rule-${RUN_ID}.json"
echo "$RULE" > "$RULE_OUT"
log_ops companion_consolidate "rule consolidate complete" "$RULE_OUT"

if [[ "${MANGO_COMPANION_LLM_NIGHTLY:-1}" == "1" ]] && [[ -f /etc/mango/llm.key || -n "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "=== Phase 2: Sonnet LLM consolidate (optional) ==="
  LLM_OUT="${OPS_DIR}/companion-llm-${RUN_ID}.json"
  if [[ -d src/orchestrator/.venv ]]; then
    (
      cd src/orchestrator
      # shellcheck disable=SC1091
      source .venv/bin/activate
      PYTHONPATH="$REPO_DIR/src/orchestrator" python3 "$REPO_DIR/scripts/m5-voice/ai/companion-nightly-llm.py" \
        2>&1 | tee "${OPS_DIR}/companion-llm-${RUN_ID}.log" \
        || echo "WARN: LLM nightly skipped/failed — continuing with gardener"
    ) || echo "WARN: LLM nightly skipped/failed — continuing with gardener"
    python3 -c "import json; print(json.dumps({'log': '${OPS_DIR}/companion-llm-${RUN_ID}.log'}))" > "$LLM_OUT"
    log_ops companion_llm "Sonnet LLM nightly" "$LLM_OUT" || true
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
GARDEN_OUT="${OPS_DIR}/companion-gardener-${RUN_ID}.json"
echo "$GARDEN" > "$GARDEN_OUT"
log_ops companion_gardener "gardener complete" "$GARDEN_OUT"

echo "=== Phase 3b: migrate empty AI catalog slots ==="
MIGRATE_OUT="${OPS_DIR}/companion-migrate-${RUN_ID}.json"
python3 - <<'PY' "$CATALOG" > "$MIGRATE_OUT"
import json, sys, urllib.request
catalog_url = sys.argv[1]
results = []
with urllib.request.urlopen(f"{catalog_url}/voice/ai-catalogs", timeout=30) as resp:
    data = json.load(resp)
for row in data.get("catalogs") or []:
    if (row.get("seed_count") or 0) == 0 and (row.get("source_count") or 0) == 0:
        slot = row["slot_id"]
        req = urllib.request.Request(
            f"{catalog_url}/voice/ai-catalogs/migrate",
            data=json.dumps({"slot_id": slot}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            results.append({"slot_id": slot, "response": json.loads(resp.read().decode())})
print(json.dumps({"migrated": results}, indent=2))
PY
cat "$MIGRATE_OUT"
log_ops ai_catalog_migrate "empty slot migrate pass" "$MIGRATE_OUT"

python3 "$REPO_DIR/scripts/diag/ops-write-run.py" \
  --kind companion_nightly \
  --run-id "$RUN_ID" \
  --source companion-nightly \
  --write-report \
  --summary "companion nightly pipeline complete" \
  --payload-file "$GARDEN_OUT"

echo "PASS: companion nightly pipeline complete"
echo "ops log: $OPS_DIR/events.jsonl"
echo "report: $OPS_DIR/reports/$(date +%Y-%m-%d)/${RUN_ID}.json"
