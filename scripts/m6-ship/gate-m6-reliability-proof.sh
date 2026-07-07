#!/usr/bin/env bash
# Pi gate for Mango Reliability Center. Fails only when couch availability is red.

set -uo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"

usage() {
  cat <<EOF
usage: $0 [--help]

Runs the Reliability Center proof gate. Red proof/API failures fail the gate;
yellow proof and served-title sample misses warn but do not fail.

Environment:
  MANGO_PROOF_SAMPLE_PER_RAIL  Served titles to resolve per rail (default: 2)
  MANGO_PROOF_SAMPLE_PLAY      Also short-play sampled titles when set to 1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

cd "$REPO_DIR" || exit 1

# shellcheck source=../lib/gate-common.sh
source "$REPO_DIR/scripts/lib/gate-common.sh"
mango_gate_init
gate_header "M6 Reliability Proof"

CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
SAMPLE_PER_RAIL="${MANGO_PROOF_SAMPLE_PER_RAIL:-2}"
SAMPLE_PLAY="${MANGO_PROOF_SAMPLE_PLAY:-0}"
out="$(mktemp)"
sample_out="$(mktemp)"
trap 'rm -f "$out" "$sample_out"; [[ "${MANGO_PROOF_SAMPLE_PLAY:-0}" == "1" ]] && gate_mpv_stop' EXIT

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

sample_served_titles() {
  python3 - "$SAMPLE_PER_RAIL" "$sample_out" <<'PY'
import json
import sys
from pathlib import Path

try:
    sample_per_rail = int(sys.argv[1])
except ValueError:
    sample_per_rail = 2
sample_per_rail = max(0, sample_per_rail)
out = Path(sys.argv[2])
json.dump(
    {
        "ok": True,
        "sample_per_rail": sample_per_rail,
        "sampled": 0,
        "broken_verified": 0,
        "items": [],
    },
    out.open("w", encoding="utf-8"),
)
PY
  [[ "$SAMPLE_PER_RAIL" == "0" ]] && return 0

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  local tab
  for tab in movies series; do
    if ! curl -sf --max-time 30 "$CATALOG/rails/items?tab=$tab" >"$tmp_dir/$tab.json"; then
      rm -rf "$tmp_dir"
      gate_warn "served-title sample fetch tab=$tab"
      return 0
    fi
  done

  python3 - "$SAMPLE_PER_RAIL" "$tmp_dir/movies.json" "$tmp_dir/series.json" "$tmp_dir/sample.jsonl" <<'PY'
import json
import sys
from pathlib import Path

sample_per_rail = max(0, int(sys.argv[1]))
out = Path(sys.argv[4])
with out.open("w", encoding="utf-8") as handle:
    for tab_path in sys.argv[2:4]:
        payload = json.load(open(tab_path, encoding="utf-8"))
        for rail in payload.get("rails") or []:
            rail_id = rail.get("rail_id")
            if rail_id in {"continue-watching", "saved"}:
                continue
            count = 0
            for item in rail.get("items") or []:
                item_type = item.get("type")
                item_id = item.get("id")
                if item_type not in {"movie", "series"} or not item_id:
                    continue
                handle.write(json.dumps({
                    "rail_id": rail_id,
                    "type": item_type,
                    "id": item_id,
                    "title": item.get("title") or item_id,
                }, separators=(",", ":")) + "\n")
                count += 1
                if count >= sample_per_rail:
                    break
PY

  local line item_type item_id rail_id title path stream_out streams play_out
  while IFS= read -r line; do
    item_type="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["type"])' "$line")"
    item_id="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["id"])' "$line")"
    rail_id="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("rail_id") or "")' "$line")"
    title="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("title") or "")' "$line")"
    path="/stream/${item_type}/$(urlencode "$item_id")"
    stream_out="$tmp_dir/stream-${item_type}-$(printf '%s' "$item_id" | tr -c '[:alnum:]' '_').json"
    streams=0
    if curl -sf --max-time 45 "$CATALOG$path" >"$stream_out"; then
      streams="$(python3 - "$stream_out" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
print(len(payload.get("streams") or []))
PY
)"
    fi
    python3 - "$sample_out" "$rail_id" "$item_type" "$item_id" "$title" "$streams" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
payload = json.load(path.open(encoding="utf-8"))
streams = int(sys.argv[6] or 0)
payload["sampled"] = int(payload.get("sampled") or 0) + 1
if streams <= 0:
    payload["broken_verified"] = int(payload.get("broken_verified") or 0) + 1
payload.setdefault("items", []).append({
    "rail_id": sys.argv[2],
    "type": sys.argv[3],
    "id": sys.argv[4],
    "title": sys.argv[5],
    "streams": streams,
})
path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY
    if [[ "$SAMPLE_PLAY" == "1" && "$streams" -gt 0 ]]; then
      play_out="$tmp_dir/play-${item_type}-$(printf '%s' "$item_id" | tr -c '[:alnum:]' '_').json"
      gate_post_play "proof-sample ${rail_id}" "$item_type" "$item_id" "$play_out" "" "" "$rail_id" "warn" || true
      gate_mpv_stop
    fi
  done <"$tmp_dir/sample.jsonl"

  rm -rf "$tmp_dir"
}

if curl -sf --max-time 5 "$CATALOG/health" >/dev/null 2>&1; then
  gate_pass "catalog /health"
else
  gate_fail "catalog /health"
  gate_finish "gate-m6-reliability-proof"
  exit $?
fi

sample_served_titles
sampled="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("sampled") or 0)' "$sample_out")"
broken_verified="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("broken_verified") or 0)' "$sample_out")"
if [[ "$broken_verified" -gt 0 ]]; then
  gate_warn "served-title sample broken_verified=${broken_verified}/${sampled}"
else
  gate_pass "served-title sample broken_verified=0/${sampled}"
fi

body="$(python3 - "$sample_out" <<'PY'
import json
import sys

sample = json.load(open(sys.argv[1], encoding="utf-8"))
metadata = {
    "served_title_sample": {
        "sample_per_rail": sample.get("sample_per_rail"),
        "sampled": sample.get("sampled"),
        "broken_verified": sample.get("broken_verified"),
        "play_probe": bool(int(__import__("os").environ.get("MANGO_PROOF_SAMPLE_PLAY", "0") or "0")),
    }
}
print(json.dumps({"reason": "gate_m6_reliability", "metadata": metadata}, separators=(",", ":")))
PY
)"
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
