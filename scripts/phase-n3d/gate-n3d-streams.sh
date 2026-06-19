#!/usr/bin/env bash
# N3d stream gate — multi-title evaluation corpus (movies + India + TV).

set -euo pipefail

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURES="${MANGO_STREAM_GATE_FIXTURES:-$REPO_DIR/config/stream-gate-fixtures.json}"
VALIDATOR="$SCRIPT_DIR/validate-stream-response.py"
TMP_DIR="${TMPDIR:-/tmp}/mango-n3d-gate"
mkdir -p "$TMP_DIR"

REQUIRE_DISPLAY_LABEL=1
if [[ "${MANGO_GATE_REQUIRE_DISPLAY_LABEL:-1}" == "0" ]]; then
  REQUIRE_DISPLAY_LABEL=0
fi

gate_header "mango N3d stream gate"

[[ -f "$FIXTURES" ]] || gate_fail "missing fixtures: $FIXTURES"
[[ -f "$VALIDATOR" ]] || gate_fail "missing validator: $VALIDATOR"

curl -sf --max-time 5 http://127.0.0.1:3035/api/v1/status >/dev/null \
  && gate_pass "AIOStreams /api/v1/status" \
  || gate_fail "AIOStreams down at http://127.0.0.1:3035/api/v1/status"

curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
  && gate_pass "catalog /health" \
  || gate_fail "catalog-service down at :3020"

FIXTURE_LABELS=()
while IFS= read -r label; do
  [[ -n "$label" ]] && FIXTURE_LABELS+=("$label")
done < <(python3 - "$FIXTURES" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
for fixture in data.get("fixtures") or []:
    print(fixture["label"])
PY
)

if ((${#FIXTURE_LABELS[@]} == 0)); then
  gate_fail "no fixtures in $FIXTURES"
fi

gate_pass "evaluation corpus: ${#FIXTURE_LABELS[@]} titles"

for label in "${FIXTURE_LABELS[@]}"; do
  read -r type id path_slug < <(python3 - "$FIXTURES" "$label" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
label = sys.argv[2]
for fixture in data.get("fixtures") or []:
    if fixture.get("label") == label:
        print(fixture["type"], fixture["id"], f"{fixture['type']}-{fixture['id']}".replace(":", "_"))
        break
else:
    raise SystemExit(f"missing fixture {label}")
PY
)

  out_json="$TMP_DIR/stream-${path_slug}.json"
  stream_url="http://127.0.0.1:3020/stream/${type}/${id}"

  if curl -sf --max-time 90 "$stream_url" >"$out_json"; then
    gate_pass "GET /stream/${type}/${id} ($label)"
  else
    gate_fail "GET /stream/${type}/${id} ($label)"
    continue
  fi

  if [[ ! -s "$out_json" ]]; then
    gate_fail "$label empty response"
    continue
  fi

  validator_args=("$out_json" "$FIXTURES" "$label")
  if [[ "$REQUIRE_DISPLAY_LABEL" == "1" ]]; then
    validator_args+=(--require-display-label)
  fi

  if summary="$(python3 "$VALIDATOR" "${validator_args[@]}")"; then
    gate_pass "$summary"
  else
    gate_fail "$label stream validation"
  fi
done

if [[ "${MANGO_N3D_PLAY_SMOKE:-0}" == "1" ]]; then
  trap gate_mpv_stop EXIT
  gate_post_play "n3d-stream" movie tt0111161 "$TMP_DIR/stream-movie-tt0111161.json"
  gate_mpv_stop
else
  gate_pass "play smoke skipped (set MANGO_N3D_PLAY_SMOKE=1)"
fi

gate_finish "N3d stream gate"
