#!/usr/bin/env bash
# Discover sports-ish channels from NexoTV and optionally probe one in mpv.
#
# Opt-in only — excluded from deploy gates (hammers NexoTV rate limits).
#
# Usage:
#   MANGO_LIVE_PROBE=1 bash scripts/live/probe-live-catalog.sh
#   MANGO_LIVE_PROBE=1 bash scripts/live/probe-live-catalog.sh --play

set -euo pipefail

if [[ "${MANGO_LIVE_PROBE:-0}" != "1" ]]; then
  echo "skip: live IPTV probe (set MANGO_LIVE_PROBE=1 to run)"
  exit 0
fi

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"
# shellcheck source=lib/nexotv.sh
source "$REPO_DIR/scripts/live/lib/nexotv.sh"

PLAY=false
[[ "${1:-}" == "--play" ]] && PLAY=true

nexotv_load_credentials || {
  echo "missing credentials — run nexotv-config.sh apply" >&2
  exit 2
}

OUT="${TMPDIR:-/tmp}/mango-live-discover-$$.json"
python3 "$REPO_DIR/scripts/live/discover-sports-channels.py" \
  --manifest-url "$NEXOTV_MANIFEST_URL" \
  --pages 10 \
  --limit 50 \
  >"$OUT" || true

python3 - "$OUT" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
print(f"matched {data.get('matched', 0)} sports-related channels")
for row in data.get("channels") or []:
    print(f"  - {row.get('name')} [{row.get('id')}]")
PY

FIRST_ID="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print((d.get("channels") or [{}])[0].get("id",""))' "$OUT" 2>/dev/null || true)"
[[ -n "$FIRST_ID" ]] || { echo "no channels to probe"; exit 1; }

STREAM_URL="$(nexotv_stream_url "$FIRST_ID")"
PLAY_URL="$(curl -sf --max-time 90 "$STREAM_URL" | python3 -c '
import json,sys
for s in json.load(sys.stdin).get("streams") or []:
    u=s.get("url")
    if isinstance(u,str) and u.startswith("http"):
        print(u); break
')"

[[ -n "$PLAY_URL" ]] || { echo "no stream url for $FIRST_ID"; exit 1; }
echo "probe url: ${PLAY_URL%%\?*}…"

bash scripts/m2-catalog/service/mpv-stop.sh >/dev/null 2>&1 || true
if $PLAY; then
  exec bash scripts/m2-catalog/service/mpv-play.sh --url "$PLAY_URL" --live --timeout-ms 60000 --min-duration-sec 5
else
  exec bash scripts/m2-catalog/service/mpv-play.sh --url "$PLAY_URL" --probe --live --timeout-ms 45000
fi
