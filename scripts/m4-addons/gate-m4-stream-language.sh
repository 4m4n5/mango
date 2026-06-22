#!/usr/bin/env bash
# N3d stream language gate — soft preferred_language vs hard language filter.

set -euo pipefail

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init

TMP_DIR="${TMPDIR:-/tmp}/mango-n3d-gate"
mkdir -p "$TMP_DIR"
FIXTURES="${MANGO_STREAM_GATE_FIXTURES:-$REPO_DIR/config/stream-gate-fixtures.json}"

gate_header "mango N3d stream language gate"

fixture_tier() {
  local label="$1"
  python3 - "$FIXTURES" "$label" <<'PY'
import json
import sys

path, label = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(path, encoding="utf-8"))
except FileNotFoundError:
    print("required")
    raise SystemExit(0)

for fixture in data.get("fixtures") or []:
    if fixture.get("label") == label:
        tier = fixture.get("tier", "required")
        if tier not in {"required", "soft", "optional"}:
            raise SystemExit(f"bad tier for {label}: {tier}")
        print(tier)
        break
else:
    print("required")
PY
}

fixture_fail() {
  local tier="$1"
  shift
  if [[ "$tier" == "required" ]]; then
    gate_fail "$*"
  else
    gate_warn "$* ($tier)"
  fi
}

stream_count() {
  python3 - "$1" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
print(len(data.get("streams") or []))
PY
}

require_count_at_least() {
  local label="$1"
  local path="$2"
  local min_count="$3"
  local tier="${4:-required}"
  local count
  count="$(stream_count "$path")"
  if [[ "$count" -ge "$min_count" ]]; then
    gate_pass "$label count=$count"
  else
    fixture_fail "$tier" "$label count=$count expected>=$min_count"
  fi
}

curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
  && gate_pass "catalog /health" \
  || gate_fail "catalog-service down at :3020"

# Policy checks on Shawshank (stable western baseline).
SHAWSHANK="http://127.0.0.1:3020/stream/movie/tt0111161?strict_unknown_cache=false"
DEFAULT_JSON="$TMP_DIR/language-default.json"
SOFT_JSON="$TMP_DIR/language-soft-klingon.json"
HARD_ENGLISH_JSON="$TMP_DIR/language-hard-english.json"
HARD_NONSENSE_JSON="$TMP_DIR/language-hard-klingon.json"

if curl -sf --max-time 60 "$SHAWSHANK" >"$DEFAULT_JSON"; then
  require_count_at_least "Shawshank default language policy" "$DEFAULT_JSON" 1
else
  gate_fail "Shawshank default stream request"
fi

if curl -sf --max-time 60 "$SHAWSHANK&preferred_language=Klingon" >"$SOFT_JSON"; then
  require_count_at_least "Shawshank soft preferred_language does not exclude" "$SOFT_JSON" 1
else
  gate_fail "Shawshank soft preferred_language request"
fi

if curl -sf --max-time 60 "$SHAWSHANK&language=English" >"$HARD_ENGLISH_JSON"; then
  require_count_at_least "Shawshank hard language=English" "$HARD_ENGLISH_JSON" 1
else
  gate_fail "Shawshank hard language=English request"
fi

if curl -sf --max-time 60 "$SHAWSHANK&language=Klingon" >"$HARD_NONSENSE_JSON"; then
  count="$(stream_count "$HARD_NONSENSE_JSON")"
  default_count="$(stream_count "$DEFAULT_JSON")"
  if [[ "$count" -eq 0 ]]; then
    gate_pass "Shawshank hard language=Klingon returned empty rows"
  elif [[ "$count" -eq "$default_count" ]]; then
    gate_fail "Shawshank hard language=Klingon unchanged ($count rows) — hard filter bypassed"
  else
    gate_fail "Shawshank hard language=Klingon returned $count rows (default=$default_count)"
  fi
else
  gate_pass "Shawshank hard language=Klingon rejected (502/empty)"
fi

# India corpus — default must resolve; Hindi hard filter is best-effort (warn if empty).
RRR_DEFAULT="$TMP_DIR/language-rrr-default.json"
RRR_HINDI="$TMP_DIR/language-rrr-hindi.json"
RRR_URL="http://127.0.0.1:3020/stream/movie/tt8178634?strict_unknown_cache=false"
RRR_TIER="$(fixture_tier RRR)"

if curl -sf --max-time 90 "$RRR_URL" >"$RRR_DEFAULT"; then
  require_count_at_least "RRR default stream policy" "$RRR_DEFAULT" 2 "$RRR_TIER"
else
  fixture_fail "$RRR_TIER" "RRR default stream request"
fi

if curl -sf --max-time 90 "$RRR_URL&language=Hindi" >"$RRR_HINDI"; then
  count="$(stream_count "$RRR_HINDI")"
  if [[ "$count" -ge 1 ]]; then
    gate_pass "RRR hard language=Hindi count=$count"
  else
    gate_warn "RRR hard language=Hindi returned 0 rows (indexer may lack Hindi-tagged releases)"
  fi
else
  gate_warn "RRR hard language=Hindi request failed (timeout or 502)"
fi

gate_finish "N3d stream language gate"
