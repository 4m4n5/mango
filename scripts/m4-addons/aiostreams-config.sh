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

verify_policy() {
  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN
  api_get >"$tmp"
  python3 - "$tmp" <<'PY'
import json
import sys

body = json.load(open(sys.argv[1], encoding="utf-8"))
config = body["data"]["userData"]
services = {str(value).lower() for value in config.get("excludeUncachedFromServices", [])}
stream_types = {str(value).lower() for value in config.get("excludeUncachedFromStreamTypes", [])}
mode = str(config.get("excludeUncachedMode", "or")).lower()

errors = []
warnings = []
if config.get("excludeUncached") is True:
    errors.append("global excludeUncached=true removes uncached TorBox")
if mode != "or":
    errors.append(f"excludeUncachedMode={mode!r}, expected 'or'")
if "torbox" in services or "debrid" in stream_types:
    errors.append("uncached TorBox is excluded")
if "realdebrid" not in services:
    errors.append("uncached Real-Debrid is not excluded")
if config.get("hideErrors") is not False:
    errors.append("stream errors are hidden from Mango")
hidden_resources = {str(value).lower() for value in config.get("hideErrorsForResources", [])}
if "stream" in hidden_resources:
    errors.append("stream errors are hidden by hideErrorsForResources")

# Topology is Pi-owned because its service credentials and generated addon
# instance IDs must never enter git. Verify only safe identifiers/booleans and
# never print the credential-bearing objects returned by /api/v1/user.
enabled_services = {
    str(service.get("id") or "").lower()
    for service in config.get("services", [])
    if isinstance(service, dict) and service.get("enabled", True) is not False
}
required_services = {"torbox", "realdebrid", "easynews"}
missing_services = sorted(required_services - enabled_services)
if missing_services:
    errors.append("required services disabled or missing: " + ", ".join(missing_services))

enabled_presets = {
    str(preset.get("type") or "").lower(): preset
    for preset in config.get("presets", [])
    if isinstance(preset, dict) and preset.get("enabled") is True
}
required_presets = {"torrentio", "comet", "mediafusion"}
missing_presets = sorted(required_presets - set(enabled_presets))
if missing_presets:
    errors.append("required stream indexers disabled or missing: " + ", ".join(missing_presets))
for preset_type in sorted(required_presets & set(enabled_presets)):
    resources = enabled_presets[preset_type].get("options", {}).get("resources")
    if isinstance(resources, list) and resources and "stream" not in {
        str(value).lower() for value in resources
    }:
        errors.append(f"{preset_type} does not expose the stream resource")

service_wrap = config.get("serviceWrap")
if not isinstance(service_wrap, dict) or service_wrap.get("enabled") is not True:
    errors.append("serviceWrap is not enabled")
elif isinstance(service_wrap.get("services"), list) and service_wrap["services"]:
    wrapped = {str(value).lower() for value in service_wrap["services"]}
    missing_wrapped = sorted({"torbox", "realdebrid"} - wrapped)
    if missing_wrapped:
        errors.append("serviceWrap omits: " + ", ".join(missing_wrapped))

groups = config.get("groups")
if isinstance(groups, dict) and groups.get("enabled", True) is not False:
    groupings = groups.get("groupings")
    if isinstance(groupings, list) and groupings:
        instance_ids = {
            str(preset.get("instanceId") or "")
            for preset in config.get("presets", [])
            if isinstance(preset, dict)
        }
        for index, grouping in enumerate(groupings, start=1):
            if not isinstance(grouping, dict):
                errors.append(f"group {index} is malformed")
                continue
            condition = grouping.get("condition")
            if not isinstance(condition, str) or not condition.strip():
                errors.append(f"group {index} has no condition")
            unknown = sorted({
                str(value) for value in grouping.get("addons", [])
                if str(value) not in instance_ids
            })
            if unknown:
                errors.append(f"group {index} references unknown addon instance IDs")
    else:
        warnings.append("groups are enabled without groupings; all indexers fan out in parallel")
else:
    warnings.append("conditional groups are disabled; all indexers fan out in parallel")

if errors:
    raise SystemExit("; ".join(errors))
for warning in warnings:
    print("AIOStreams policy warning: " + warning, file=sys.stderr)
print(
    "AIOStreams live policy verified: TorBox/RD/Easynews enabled; "
    "Torrentio/Comet/MediaFusion enabled; uncached TorBox retained; "
    "uncached RD excluded; stream errors observable"
)
PY
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
  verify)
    load_creds
    verify_policy
    ;;
  *)
    cat <<EOF
Usage: $(basename "$0") <get|diff|apply|verify>

  get    Download full user config (contains secrets — do not commit)
  diff   Show delta vs config/aiostreams-target-patch.json
  apply  Merge patch and PUT /api/v1/user
  verify Assert the live stream topology/policy without printing credentials

Env: MANGO_AIOSTREAMS_URL, MANGO_AIOSTREAMS_CREDS, MANGO_AIOSTREAMS_PATCH
EOF
    exit 1
    ;;
esac
