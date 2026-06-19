#!/usr/bin/env bash
# N3d readiness diagnostic — safe to run on Pi (no secrets printed).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

# shellcheck source=lib/aiometadata.sh
source "$REPO_DIR/scripts/phase-n3d/lib/aiometadata.sh"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

ok() { echo "OK   $*"; }
warn() { echo "WARN $*"; }
bad() { echo "FAIL $*"; }

echo "=== mango N3d diagnostic $(date -Iseconds) ==="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "MANGO_CATALOG=${MANGO_CATALOG:-0} MANGO_SELF_HOSTED_ADDONS=${MANGO_SELF_HOSTED_ADDONS:-0}"
echo

# Docker
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "docker daemon"
  docker ps --format '  {{.Names}} {{.Status}}' 2>/dev/null | grep -E 'mango-aiostreams|mango-aiometadata' || warn "no mango addon containers running"
else
  bad "docker missing or daemon down — run: bash scripts/phase-n3d/bootstrap-docker.sh"
fi

# Local services
curl_health() {
  local port="$1" path="$2"
  curl -sf --max-time 5 "http://127.0.0.1:${port}${path}" >/dev/null 2>&1
}

for spec in "3035:AIOStreams:/api/v1/status" "3020:catalog:/health"; do
  IFS=: read -r port name path <<<"$spec"
  if curl_health "$port" "$path"; then
    ok "$name :$port"
  else
    bad "$name :$port not reachable"
  fi
done
if aiometadata_health_ok; then
  ok "AIOMetadata :3036/health"
else
  bad "AIOMetadata :3036/health not reachable"
fi
if aiometadata_manifest_ok; then
  ok "AIOMetadata manifest (export)"
else
  bad "AIOMetadata manifest missing or unreachable"
fi
curl -sf --max-time 3 http://127.0.0.1:3000/ >/dev/null 2>&1 && ok "launcher :3000" || bad "launcher :3000"

# stremio-export addon contract
EXPORT="/etc/mango/stremio-export.json"
if [[ -f "$EXPORT" ]]; then
  python3 - "$EXPORT" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path, encoding="utf-8"))
names = [a.get("name", "") for a in data.get("addons", [])]
checks = [
    ("AIOStreams", lambda n: n == "AIOStreams"),
    ("AIOMetadata", lambda n: n == "AIOMetadata"),
    ("no ElfHosted", lambda n: "ElfHosted" not in n),
    ("local AIOStreams URL", lambda n: False),
]
local_aiostreams = any(
    a.get("name") == "AIOStreams" and str(a.get("manifestUrl", "")).startswith("http://127.0.0.1:3035")
    for a in data.get("addons", [])
)
local_aiometadata = any(
    a.get("name") == "AIOMetadata" and str(a.get("manifestUrl", "")).startswith("http://127.0.0.1:3036")
    for a in data.get("addons", [])
)
print("OK   stremio-export present" if names else "FAIL stremio-export empty")
for n in names:
    print(f"     addon: {n}")
if any("ElfHosted" in n for n in names):
    print("FAIL ElfHosted addons still in export — migrate to local AIOStreams/AIOMetadata")
elif local_aiostreams:
    print("OK   AIOStreams manifest is localhost:3035")
else:
    print("WARN AIOStreams not pointing at 127.0.0.1:3035 yet")
if local_aiometadata:
    print("OK   AIOMetadata manifest is localhost:3036")
elif "AIOMetadata" in names:
    print("WARN AIOMetadata not pointing at 127.0.0.1:3036 yet")
else:
    print("WARN AIOMetadata missing from export")
if "AIOLists" in names:
    print("WARN AIOLists still in export — migrate to AIOMetadata")
if any(n == "IndiaStreams" for n in names):
    print("WARN IndiaStreams still in export — removed from N3d V1 catalog rails")
PY
else
  bad "missing $EXPORT"
fi

# catalog.yaml sync
if cmp -s config/catalog.example.yaml /etc/mango/catalog.yaml 2>/dev/null; then
  ok "catalog.yaml synced with repo"
else
  warn "catalog.yaml differs — mango-stack uses repo example until: sudo cp config/catalog.example.yaml /etc/mango/catalog.yaml"
fi

# catalog-service graph
HEALTH_JSON="$(curl -sf --max-time 5 http://127.0.0.1:3020/health 2>/dev/null || true)"
if [[ -n "$HEALTH_JSON" ]]; then
  echo "$HEALTH_JSON" | python3 -c '
import json, sys
h = json.load(sys.stdin)
print("OK   catalog-service addons=%s rails=%s rss_mb=%s" % (h.get("addons"), h.get("rails"), h.get("rss_mb")))
bad = [n for n in h.get("addon_names", []) if "ElfHosted" in n]
if bad:
    print("FAIL catalog still loading ElfHosted:", ", ".join(bad))
'
else
  bad "catalog-service health unreachable"
fi

# playability.db
DB="/etc/mango/playability.db"
if [[ -f "$DB" ]]; then
  python3 - "$DB" <<'PY'
import sqlite3, sys, time
db = sys.argv[1]
now = int(time.time() * 1000)
c = sqlite3.connect(db)
vt = c.execute("SELECT COUNT(*) FROM titles WHERE status='verified'").fetchone()[0]
ft = c.execute("SELECT COUNT(*) FROM titles WHERE status='failed'").fetchone()[0]
pt = c.execute("SELECT COUNT(*) FROM rail_pool").fetchone()[0]
new = c.execute("""
  SELECT COUNT(DISTINCT rail_id) FROM rail_pool
  WHERE rail_id LIKE 'movies-%' OR rail_id LIKE 'series-%'
""").fetchone()[0]
print(f"OK   playability.db verified={vt} failed={ft} pool={pt} new_rails_with_pool={new}")
if new == 0:
    print("WARN no pool entries for movies-* / series-* rails — run maintenance after stream plane is healthy")
PY
else
  warn "playability.db missing — will be created on first indexer run"
fi

# deploy secrets files (presence only)
[[ -f deploy/aiostreams/.env ]] && ok "deploy/aiostreams/.env present" || bad "deploy/aiostreams/.env missing — cp .env.example and set SECRET_KEY"
[[ -f deploy/aiometadata/.env ]] && ok "deploy/aiometadata/.env present" || warn "deploy/aiometadata/.env missing — cp deploy/aiometadata/.env.example"
[[ -f /etc/mango/aiostreams.enabled || "${MANGO_SELF_HOSTED_ADDONS:-0}" == "1" ]] \
  && ok "self-hosted gate flag set" \
  || warn "set MANGO_SELF_HOSTED_ADDONS=1 or: sudo touch /etc/mango/aiostreams.enabled"

echo
echo "Next: bash scripts/phase-n3d/gate-n3d-self-hosted.sh"
