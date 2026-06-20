#!/usr/bin/env bash
# Live IPTV gate — NexoTV health, catalog, stream resolve, headless mpv probe.
#
# Opt-in only — excluded from gate-lite / pre-couch gates (hammers NexoTV rate limits).
#
# Usage:
#   MANGO_LIVE_GATE=1 bash scripts/phase-live/gate-live-iptv.sh
#   MANGO_LIVE_GATE=1 MANGO_LIVE_PLAY=1 bash scripts/phase-live/gate-live-iptv.sh
#
# Prereqs:
#   bash scripts/phase-live/install-nexotv.sh
#   bash scripts/phase-live/nexotv-config.sh init-profiles
#   bash scripts/phase-live/nexotv-config.sh apply iptv-org-sports
#   bash scripts/phase-live/nexotv-config.sh wire-export

set -euo pipefail

if [[ "${MANGO_LIVE_GATE:-0}" != "1" ]]; then
  echo "skip: live IPTV gate (set MANGO_LIVE_GATE=1 to run — excluded from deploy gates)"
  exit 0
fi

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

# shellcheck source=../lib/gate-common.sh
source "$REPO_DIR/scripts/lib/gate-common.sh"
# shellcheck source=lib/nexotv.sh
source "$REPO_DIR/scripts/phase-live/lib/nexotv.sh"

mango_gate_init
gate_header "mango live IPTV gate (NexoTV)"

TMP="${TMPDIR:-/tmp}/mango-live-gate-$$"
mkdir -p "$TMP"
trap 'bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

nexotv_health_ok && gate_pass "NexoTV /health" || gate_fail "NexoTV down — install-nexotv.sh"

nexotv_load_credentials || gate_fail "missing ~/.config/mango/nexotv.credentials — nexotv-config.sh apply"
gate_pass "nexotv credentials ($NEXOTV_PROFILE_ID)"

if curl -sf --max-time 30 "$NEXOTV_MANIFEST_URL" >"$TMP/manifest.json"; then
  gate_pass "manifest.json"
else
  gate_fail "manifest fetch failed"
fi

if python3 - "$TMP/manifest.json" <<'PY'; then
import json, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
types = m.get("types") or []
catalogs = m.get("catalogs") or []
assert "tv" in types, f"types={types}"
assert any(c.get("id") == "iptv_channels" for c in catalogs), catalogs
PY
  gate_pass "manifest tv catalog"
else
  gate_fail "manifest missing tv catalog"
fi

DISCOVER="$TMP/discover.json"
if python3 "$REPO_DIR/scripts/phase-live/discover-sports-channels.py" \
  --manifest-url "$NEXOTV_MANIFEST_URL" \
  --pages 8 \
  --limit 25 \
  >"$DISCOVER"; then
  MATCHED="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["matched"])' "$DISCOVER")"
  gate_pass "sports catalog scan ($MATCHED channels)"
else
  gate_warn "no sports keyword matches — trying first catalog item"
  curl -sf --max-time 60 "$(nexotv_catalog_url 0)" >"$TMP/catalog.json" || gate_fail "catalog fetch"
  python3 - "$TMP/catalog.json" "$DISCOVER" <<'PY'
import json, sys
cat = json.load(open(sys.argv[1], encoding="utf-8"))
metas = cat.get("metas") or []
if not metas:
    raise SystemExit("empty catalog")
first = metas[0]
out = {"matched": 1, "channels": [{"id": first["id"], "name": first.get("name") or first["id"]}]}
json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), indent=2)
PY
  gate_warn "fallback catalog item used"
fi

CHANNEL_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["channels"][0]["id"])' "$DISCOVER")"
CHANNEL_NAME="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["channels"][0]["name"])' "$DISCOVER")"
echo "pick: $CHANNEL_NAME ($CHANNEL_ID)"

STREAM_URL="$(nexotv_stream_url "$CHANNEL_ID")"
curl -sf --max-time 90 "$STREAM_URL" >"$TMP/stream.json" || gate_fail "stream resolve"
python3 - "$TMP/stream.json" <<'PY' || gate_fail "no playable stream url"
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
streams = data.get("streams") or []
urls = [s.get("url") for s in streams if isinstance(s.get("url"), str) and s["url"].startswith("http")]
if not urls:
    raise SystemExit("no http streams")
print(urls[0])
PY
PLAY_URL="$(python3 - "$TMP/stream.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
for s in data.get("streams") or []:
    u = s.get("url")
    if isinstance(u, str) and u.startswith("http"):
        print(u)
        break
PY
)"
gate_pass "stream url resolved"

bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true
if bash scripts/phase-n1/mpv-play.sh \
  --url "$PLAY_URL" \
  --probe \
  --live \
  --timeout-ms 45000; then
  gate_pass "mpv live probe (headless)"
else
  gate_fail "mpv live probe"
fi

if [[ "${MANGO_LIVE_PLAY:-0}" == "1" ]]; then
  bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true
  echo "== couch play smoke (8s) =="
  bash scripts/phase-n1/mpv-play.sh --url "$PLAY_URL" --live --timeout-ms 12000 --min-duration-sec 3 &
  sleep 8
  bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true
  gate_pass "couch play smoke"
fi

# Optional catalog-service graph when live TV wired into export + catalog restarted
if [[ "${MANGO_CATALOG:-0}" == "1" ]]; then
  if curl -sf --max-time 5 http://127.0.0.1:3020/health | python3 -c '
import json,sys
h=json.load(sys.stdin)
names=h.get("addon_names") or []
import sys as _s
_s.exit(0 if any("Live TV" in n or n == "NexoTV" for n in names) else 1)
'; then
    gate_pass "catalog-service sees live TV addon"
  else
    gate_warn "restart catalog-service after wire-export"
  fi
fi

gate_finish "live IPTV gate"
