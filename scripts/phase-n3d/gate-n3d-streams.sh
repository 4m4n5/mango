#!/usr/bin/env bash
# N3d stream gate — local AIOStreams resolves without ElfHosted rate-limit URLs.

set -euo pipefail

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init

TMP_DIR="${TMPDIR:-/tmp}/mango-n3d-gate"
mkdir -p "$TMP_DIR"
STREAM_JSON="$TMP_DIR/stream-tt0111161.json"
PLAY_JSON="$TMP_DIR/play-tt0111161.json"

gate_header "mango N3d stream gate"

curl -sf --max-time 5 http://127.0.0.1:3035/api/v1/status >/dev/null \
  && gate_pass "AIOStreams /api/v1/status" \
  || gate_fail "AIOStreams down at http://127.0.0.1:3035/api/v1/status"

curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
  && gate_pass "catalog /health" \
  || gate_fail "catalog-service down at :3020"

if curl -sf --max-time 30 "http://127.0.0.1:3020/stream/movie/tt0111161" >"$STREAM_JSON"; then
  gate_pass "GET /stream/movie/tt0111161"
else
  gate_fail "GET /stream/movie/tt0111161"
fi

if [[ -s "$STREAM_JSON" ]]; then
  if python3 - "$STREAM_JSON" <<'PY'
import json
import re
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
streams = data.get("streams") or []
if not streams:
    raise SystemExit("no streams returned")

bad_urls = [
    stream.get("url", "")
    for stream in streams
    if re.search(r"rate-limit-exceeded|public-rate-limit", stream.get("url", ""), re.I)
]
if bad_urls:
    raise SystemExit(f"rate-limit placeholder URLs returned: {len(bad_urls)}")

sources = sorted({str(stream.get("source") or "") for stream in streams})
if not any(source == "AIOStreams" for source in sources):
    raise SystemExit(f"AIOStreams source missing; sources={sources}")
if any("ElfHosted" in source for source in sources):
    raise SystemExit(f"ElfHosted stream source still present; sources={sources}")

print(f"streams={len(streams)} sources={','.join(sources)}")
PY
  then
    gate_pass "AIOStreams stream source and URLs"
  else
    gate_fail "AIOStreams stream source and URLs"
  fi
fi

if [[ "${MANGO_N3D_PLAY_SMOKE:-0}" == "1" ]]; then
  trap gate_mpv_stop EXIT
  gate_post_play "n3d-stream" movie tt0111161 "$PLAY_JSON"
  gate_mpv_stop
else
  gate_pass "play smoke skipped (set MANGO_N3D_PLAY_SMOKE=1)"
fi

gate_finish "N3d stream gate"
