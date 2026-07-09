#!/usr/bin/env bash
# Nightly companion pipeline — rule → optional Sonnet LLM → gardener → migrate empty AI slots.
# Timer: bash scripts/m5-voice/ai/install-companion-nightly-timer.sh (06:00 daily)
# Cron fallback: 0 6 * * * cd ~/mango && bash scripts/m5-voice/ai/companion-nightly-consolidate.sh
set -uo pipefail

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

# --- Overlap guard -----------------------------------------------------------
# If the playability maintenance lock is still held (grow overran into our
# window), skip cleanly rather than hammering an already-strained catalog.
# The timer fires at 06:00 by default; this is defense in depth.
LOCK_FILE="${CACHE_DIR}/playability-maintenance.lock"
playability_lock_busy() (
  exec 201>"$LOCK_FILE"
  ! flock -n 201
)
if [[ "${MANGO_COMPANION_SKIP_IF_GROW_RUNNING:-1}" == "1" ]] \
    && [[ -f "$LOCK_FILE" ]] \
    && playability_lock_busy; then
  echo "companion-nightly: SKIP — playability maintenance still running (grow window overlap)"
  echo "companion-nightly: will retry on next timer fire"
  exit 0
fi

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

# --- Retry helper ------------------------------------------------------------
# POSTs JSON with retry+backoff. Prints response body on success (ok:true),
# returns 0 on success, 1 on failure. Tolerates transient catalog contention
# (empty responses, non-2xx) that used to hard-crash the pipeline via a
# JSONDecodeError on empty stdin.
post_json_ok() {
  local url="$1"
  local body="${2:-{}}"
  local attempts="${3:-3}"
  local i out rc
  for (( i=1; i<=attempts; i++ )); do
    out="$(curl -sf --max-time 30 -X POST "$url" \
      -H 'content-type: application/json' -d "$body" 2>/dev/null)"
    rc=$?
    if [[ $rc -eq 0 ]] && [[ -n "$out" ]] \
      && printf '%s' "$out" \
        | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("ok") is True else 1)' \
        2>/dev/null; then
      printf '%s' "$out"
      return 0
    fi
    if (( i < attempts )); then
      echo "  attempt $i/$attempts failed (curl_rc=$rc body_len=${#out}); retry in $((i * 5))s" >&2
      sleep $((i * 5))
    fi
  done
  return 1
}

bash "$REPO_DIR/scripts/m5-voice/ai/sync-companion-example.sh" || true

# --- Phase 1: rule consolidate ----------------------------------------------
CONSOLIDATE_OK=0
RULE=""
RULE_OUT=""
echo "=== Phase 1: rule consolidate ==="
if RULE="$(post_json_ok "$CATALOG/voice/companion/consolidate" '{}' 3)"; then
  echo "PASS: rule consolidate"
  RULE_OUT="${OPS_DIR}/companion-rule-${RUN_ID}.json"
  echo "$RULE" > "$RULE_OUT"
  log_ops companion_consolidate "rule consolidate complete" "$RULE_OUT" || true
  CONSOLIDATE_OK=1
else
  echo "WARN: rule consolidate failed after retries — skipping this phase" >&2
fi

# --- Phase 2: optional Sonnet LLM consolidate --------------------------------
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

# --- Phase 3: catalog gardener ----------------------------------------------
GARDENER_OK=0
GARDEN=""
GARDEN_OUT=""
echo "=== Phase 3: catalog gardener ==="
if GARDEN="$(post_json_ok "$CATALOG/voice/companion/gardener" '{}' 3)"; then
  echo "PASS: gardener"
  echo "$GARDEN"
  GARDEN_OUT="${OPS_DIR}/companion-gardener-${RUN_ID}.json"
  echo "$GARDEN" > "$GARDEN_OUT"
  log_ops companion_gardener "gardener complete" "$GARDEN_OUT" || true
  GARDENER_OK=1
else
  echo "WARN: gardener failed after retries — skipping" >&2
fi

# If both main API-driven phases failed, the catalog is in a bad state — bail
# so systemd flags it. If either succeeded, continue: transient hiccups on one
# phase should not swallow useful work done by the other.
if [[ "$CONSOLIDATE_OK" -eq 0 && "$GARDENER_OK" -eq 0 ]]; then
  echo "FAIL: both consolidate and gardener failed — likely catalog issue, not transient" >&2
  exit 1
fi

# --- Phase 3b: migrate empty AI catalog slots --------------------------------
echo "=== Phase 3b: migrate empty AI catalog slots ==="
MIGRATE_OUT="${OPS_DIR}/companion-migrate-${RUN_ID}.json"
if python3 - <<'PY' "$CATALOG" > "$MIGRATE_OUT" 2>&1; then
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
  log_ops ai_catalog_migrate "empty slot migrate pass" "$MIGRATE_OUT" || true
else
  echo "WARN: AI catalog migrate pass failed — see $MIGRATE_OUT" >&2
  cat "$MIGRATE_OUT" >&2 || true
fi

# --- Final report ------------------------------------------------------------
# Prefer gardener payload; fall back to whatever we have so the report is written.
FINAL_PAYLOAD="${GARDEN_OUT:-${RULE_OUT:-$MIGRATE_OUT}}"
if [[ -n "$FINAL_PAYLOAD" && -f "$FINAL_PAYLOAD" ]]; then
  python3 "$REPO_DIR/scripts/diag/ops-write-run.py" \
    --kind companion_nightly \
    --run-id "$RUN_ID" \
    --source companion-nightly \
    --write-report \
    --summary "companion nightly pipeline complete (consolidate=$CONSOLIDATE_OK gardener=$GARDENER_OK)" \
    --payload-file "$FINAL_PAYLOAD" || true
fi

echo "PASS: companion nightly pipeline complete (consolidate=$CONSOLIDATE_OK gardener=$GARDENER_OK)"
echo "ops log: $OPS_DIR/events.jsonl"
echo "report: $OPS_DIR/reports/$(date +%Y-%m-%d)/${RUN_ID}.json"
