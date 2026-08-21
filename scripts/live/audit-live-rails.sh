#!/usr/bin/env bash
# Audit live tab rails on catalog-service — lists items per rail for couch review.
set -euo pipefail

CATALOG_URL="${MANGO_CATALOG_URL:-http://127.0.0.1:3020}"
TIMEOUT="${MANGO_LIVE_AUDIT_TIMEOUT:-90}"

payload="$(curl -sf --max-time "$TIMEOUT" "${CATALOG_URL}/rails/items?tab=live")" || {
  echo "audit-live-rails: catalog unreachable at $CATALOG_URL" >&2
  exit 1
}

python3 - "$payload" <<'PY'
import json, sys

data = json.loads(sys.argv[1])
rails = data.get("rails") or []
print(f"tab=live rails={len(rails)} resolve_ms={data.get('resolve_ms')} cached={data.get('cached')} stale={data.get('stale')}")
if not rails:
    print("WARN: no live rails returned")
    sys.exit(1)

bad = 0
for rail in rails:
    rid = rail.get("rail_id", "?")
    label = rail.get("label", rid)
    items = rail.get("items") or []
    print(f"\n== {rid} ({label}) — {len(items)} items ==")
    if not items:
        print("  WARN: empty rail")
        bad += 1
        continue
    for item in items:
        title = item.get("title", "?")
        source = item.get("source", "?")
        print(f"  {title} | {source}")
        tl = title.lower()
        if rid == "live-football" and "prime:" in tl and "world cup" not in tl:
            print("    WARN: non-football PRIME channel in football rail")
            bad += 1
        if rid == "live-cricket" and not any(k in tl for k in ("cricket", "star sports", "willow", "dd sports")):
            print("    WARN: unexpected cricket rail entry")
            bad += 1

sys.exit(1 if bad else 0)
PY
