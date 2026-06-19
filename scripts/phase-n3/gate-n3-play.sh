#!/usr/bin/env bash
# Phase N3 play gate — one random browse pick + Shawshank (legacy; prefer gate-n3c).

set -euo pipefail

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init

TMP_DIR="${TMPDIR:-/tmp}/mango-n3-gate"
mkdir -p "$TMP_DIR"
trap gate_mpv_stop EXIT

gate_header "mango N3 play gate"

bash scripts/phase-n3/check-n3-prereqs.sh >/dev/null && gate_pass "prereqs" || gate_fail "prereqs"

TRENDING_JSON="$TMP_DIR/trending-india.json"
PICK_JSON="$TMP_DIR/trending-pick.json"
if curl -sf --max-time 30 http://127.0.0.1:3020/rails/trending-india/items >"$TRENDING_JSON"; then
  python3 - "$TRENDING_JSON" "$PICK_JSON" <<'PY' && gate_pass "random pick" || gate_fail "random pick"
import json, random, sys
items = [i for i in json.load(open(sys.argv[1])).get("items", []) if i.get("id") != "tt0111161"]
if not items:
    raise SystemExit("no items")
pick = random.SystemRandom().choice(items)
json.dump(pick, open(sys.argv[2], "w"))
PY
  pick_id="$(python3 -c "import json; print(json.load(open('$PICK_JSON'))['id'])")"
  pick_type="$(python3 -c "import json; d=json.load(open('$PICK_JSON')); print(d.get('type') or 'movie')")"
  gate_post_play "browse" "$pick_type" "$pick_id" "$TMP_DIR/play-browse.json"
  gate_mpv_stop
else
  gate_fail "GET trending-india"
fi

gate_post_play "shawshank" "movie" "tt0111161" "$TMP_DIR/play-shawshank.json"
gate_mpv_stop

gate_finish "N3 gate" || exit 1
