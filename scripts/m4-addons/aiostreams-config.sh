#!/usr/bin/env bash
# Headless AIOStreams user config — GET/PUT /api/v1/user
# Credentials: ~/.config/mango/aiostreams.credentials (AIOSTREAMS_UUID, AIOSTREAMS_PASSWORD)
# Target patch: config/aiostreams-target-patch.json (repo root)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CREDS="${MANGO_AIOSTREAMS_CREDS:-$HOME/.config/mango/aiostreams.credentials}"
BASE_URL="${MANGO_AIOSTREAMS_URL:-http://127.0.0.1:3035}"
PATCH_FILE="${MANGO_AIOSTREAMS_PATCH:-$REPO_DIR/config/aiostreams-target-patch.json}"

die() { echo "aiostreams-config: $*" >&2; exit 1; }

load_creds() {
  [[ -f "$CREDS" ]] || die "missing $CREDS"
  # shellcheck disable=SC1090
  source "$CREDS"
  [[ -n "${AIOSTREAMS_UUID:-}" && -n "${AIOSTREAMS_PASSWORD:-}" ]] \
    || die "AIOSTREAMS_UUID and AIOSTREAMS_PASSWORD required in $CREDS"
  export AIOSTREAMS_UUID AIOSTREAMS_PASSWORD
}

api_get() {
  curl -sf -u "$AIOSTREAMS_UUID:$AIOSTREAMS_PASSWORD" "$BASE_URL/api/v1/user"
}

merge_patch() {
  local mode="$1"
  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN
  api_get >"$tmp"
  python3 - "$PATCH_FILE" "$mode" "$tmp" <<'PY'
import json
import sys

patch_path, mode, body_path = sys.argv[1], sys.argv[2], sys.argv[3]
patch = json.load(open(patch_path, encoding="utf-8"))
patch.pop("_comment", None)
body = json.load(open(body_path, encoding="utf-8"))
config = body["data"]["userData"]
merged = json.loads(json.dumps(config))

def deep_merge(base, overlay):
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            deep_merge(base[key], value)
        else:
            base[key] = value

deep_merge(merged, patch)

if mode == "diff":
    changed = sorted({k for k in set(config) | set(merged) if config.get(k) != merged.get(k)})
    print("keys that would change:", ", ".join(changed) or "(none)")
    for key in changed:
        print(f"\n--- {key} ---")
        print("current:", json.dumps(config.get(key), indent=2)[:1200])
        print("target: ", json.dumps(merged.get(key), indent=2)[:1200])
else:
    print(json.dumps(merged))
PY
}

cmd="${1:-}"
case "$cmd" in
  get)
    load_creds
    api_get | python3 -m json.tool
    ;;
  diff)
    load_creds
    [[ -f "$PATCH_FILE" ]] || die "missing patch file $PATCH_FILE"
    merge_patch diff
    ;;
  apply)
    load_creds
    [[ -f "$PATCH_FILE" ]] || die "missing patch file $PATCH_FILE"
    merged="$(merge_patch apply)"
    payload="$(MERGED="$merged" python3 - <<'PY'
import json, os
config = json.loads(os.environ["MERGED"])
import os as o
print(json.dumps({"uuid": o.environ["AIOSTREAMS_UUID"], "password": o.environ["AIOSTREAMS_PASSWORD"], "config": config}))
PY
)"
    http_code="$(printf '%s' "$payload" | curl -s -w '%{http_code}' -o /tmp/aiostreams-put.json -u "$AIOSTREAMS_UUID:$AIOSTREAMS_PASSWORD" \
      -H "Content-Type: application/json" -X PUT -d @- "$BASE_URL/api/v1/user")"
    if [[ "$http_code" != "200" ]]; then
      cat /tmp/aiostreams-put.json >&2
      die "PUT /api/v1/user failed (HTTP $http_code)"
    fi
    python3 -m json.tool /tmp/aiostreams-put.json
    echo "applied patch from $PATCH_FILE"
    ;;
  *)
    cat <<EOF
Usage: $(basename "$0") <get|diff|apply>

  get    Download full user config (contains secrets — do not commit)
  diff   Show delta vs config/aiostreams-target-patch.json
  apply  Merge patch and PUT /api/v1/user

Env: MANGO_AIOSTREAMS_URL, MANGO_AIOSTREAMS_CREDS, MANGO_AIOSTREAMS_PATCH
EOF
    exit 1
    ;;
esac
