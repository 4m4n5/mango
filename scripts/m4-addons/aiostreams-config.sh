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
POLICY_TOOL="$SCRIPT_DIR/aiostreams_policy.py"
MEDIAFUSION_BASE_MANIFEST="https://mediafusion.elfhosted.com/manifest.json"

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

secure_tmpdir() {
  local previous_umask
  previous_umask="$(umask)"
  umask 077
  mktemp -d
  umask "$previous_umask"
}

api_put_payload() {
  local payload_file="$1"
  local response_file="$2"
  curl -sS -o "$response_file" -w '%{http_code}' \
    -u "$AIOSTREAMS_UUID:$AIOSTREAMS_PASSWORD" \
    -H "Content-Type: application/json" -X PUT -d @"$payload_file" \
    "$BASE_URL/api/v1/user"
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
if not str(config.get("tvdbApiKey") or "").strip():
    errors.append("TVDB API key is not configured")

all_presets = {
    str(preset.get("type") or "").lower(): preset
    for preset in config.get("presets", [])
    if isinstance(preset, dict)
}
easynews = all_presets.get("easynews-search")
easynews_timeout = int(((easynews or {}).get("options") or {}).get("timeout") or 0)
if not easynews or easynews.get("enabled") is not True:
    errors.append("Easynews Search preset disabled or missing")
elif easynews_timeout < 30000:
    errors.append(
        f"Easynews Search timeout={easynews_timeout}ms, expected at least 30000ms "
        "for daily-series season searches"
    )
enabled_presets = {
    key: preset
    for key, preset in all_presets.items()
    if preset.get("enabled") is True
}
# Torrentio + Comet are the required always-on AIOStreams indexers. MediaFusion
# remains a configured contributor, but its ElfHosted override URL is
# operator-owned and may be intentionally disabled when the share 404s.
required_enabled_presets = {"torrentio", "comet"}
missing_enabled = sorted(required_enabled_presets - set(enabled_presets))
if missing_enabled:
    errors.append("required stream indexers disabled or missing: " + ", ".join(missing_enabled))
if "mediafusion" not in all_presets:
    errors.append("required stream indexer preset missing: mediafusion")
elif "mediafusion" not in enabled_presets:
    warnings.append(
        "MediaFusion preset is present but disabled "
        "(re-enable after the operator manifest is healthy)"
    )
for preset_type in sorted(required_enabled_presets & set(enabled_presets)):
    resources = enabled_presets[preset_type].get("options", {}).get("resources")
    if isinstance(resources, list) and resources and "stream" not in {
        str(value).lower() for value in resources
    }:
        errors.append(f"{preset_type} does not expose the stream resource")
if "mediafusion" in enabled_presets:
    resources = enabled_presets["mediafusion"].get("options", {}).get("resources")
    if isinstance(resources, list) and resources and "stream" not in {
        str(value).lower() for value in resources
    }:
        errors.append("mediafusion does not expose the stream resource")

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
mediafusion_state = (
    "MediaFusion enabled"
    if "mediafusion" in enabled_presets
    else "MediaFusion present (disabled)"
)
print(
    "AIOStreams live policy verified: TorBox/RD/Easynews enabled; "
    f"Torrentio/Comet enabled; {mediafusion_state}; uncached TorBox retained; "
    "uncached RD excluded; stream errors observable"
)
PY
  if python3 - "$tmp" <<'PY'
import json
import sys

body = json.load(open(sys.argv[1], encoding="utf-8"))
presets = body["data"]["userData"].get("presets", [])
enabled = any(
    isinstance(preset, dict)
    and str(preset.get("type") or "").lower() == "mediafusion"
    and preset.get("enabled") is True
    for preset in presets
)
raise SystemExit(0 if enabled else 1)
PY
  then
    python3 "$POLICY_TOOL" verify-mediafusion "$tmp"
  fi
}

merge_patch() {
  local mode="$1"
  local output_file="${2:-}"
  local input_file="${3:-}"
  local tmp
  if [[ -n "$input_file" ]]; then
    tmp="$input_file"
  else
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' RETURN
    api_get >"$tmp"
  fi
  python3 - "$PATCH_FILE" "$mode" "$tmp" "$output_file" <<'PY'
import json
import sys

patch_path, mode, body_path, output_path = sys.argv[1:5]
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

# Easynews season searches routinely take 18-25 seconds on the Pi. AIOStreams'
# 7-second preset default aborts before exact daily-series results already found
# by the source can be transformed. Preserve the credential-bearing preset and
# adjust only its non-secret timeout in-place.
for preset in merged.get("presets", []):
    if isinstance(preset, dict) and str(preset.get("type") or "").lower() == "easynews-search":
        options = preset.setdefault("options", {})
        options["timeout"] = max(int(options.get("timeout") or 0), 30000)

if mode == "diff":
    changed = sorted({k for k in set(config) | set(merged) if config.get(k) != merged.get(k)})
    print("keys that would change:", ", ".join(changed) or "(none)")
    print("values hidden: AIOStreams user state may contain credentials and signed URLs")
else:
    if not output_path:
        raise SystemExit("apply mode requires an output path")
    body["data"]["userData"] = merged
    with open(output_path, "w", encoding="utf-8") as output:
        json.dump(body, output, separators=(",", ":"))
PY
}

apply_target_patch() (
  set -euo pipefail
  local tmpdir current patched payload rollback response code rollback_code
  tmpdir="$(secure_tmpdir)"
  trap 'rm -rf "$tmpdir"' EXIT
  current="$tmpdir/current.json"
  patched="$tmpdir/patched.json"
  payload="$tmpdir/payload.json"
  rollback="$tmpdir/rollback-payload.json"
  response="$tmpdir/response.json"
  api_get >"$current"
  merge_patch apply "$patched" "$current"
  python3 "$POLICY_TOOL" prepare-put "$patched" "$payload"
  python3 "$POLICY_TOOL" prepare-put "$current" "$rollback"
  code="$(api_put_payload "$payload" "$response" || true)"
  if [[ "$code" != "200" ]]; then
    rollback_code="$(api_put_payload "$rollback" "$response" || true)"
    if [[ "$rollback_code" == "200" ]]; then
      die "PUT /api/v1/user failed (HTTP ${code:-unavailable}); original user state restored"
    fi
    die "PUT /api/v1/user failed (HTTP ${code:-unavailable}) and automatic rollback failed (HTTP ${rollback_code:-unavailable})"
  fi
  if ! verify_policy; then
    rollback_code="$(api_put_payload "$rollback" "$response" || true)"
    if [[ "$rollback_code" == "200" ]]; then
      die "AIOStreams patch verification failed; original user state restored"
    fi
    die "AIOStreams patch verification failed and automatic rollback failed (HTTP $rollback_code)"
  fi
  echo "applied patch from $PATCH_FILE (response hidden)"
)

enable_mediafusion() (
  set -euo pipefail
  local tmpdir current payload rollback response manifest readback code rollback_code
  tmpdir="$(secure_tmpdir)"
  trap 'rm -rf "$tmpdir"' EXIT
  current="$tmpdir/current.json"
  payload="$tmpdir/mediafusion-payload.json"
  rollback="$tmpdir/rollback-payload.json"
  response="$tmpdir/response.json"
  manifest="$tmpdir/mediafusion-manifest.json"
  readback="$tmpdir/readback.json"

  code="$(curl -sS --max-time 12 --max-filesize 1048576 -o "$manifest" \
    -w '%{http_code}' "$MEDIAFUSION_BASE_MANIFEST" || true)"
  [[ "$code" == "200" ]] \
    || die "MediaFusion base manifest is unhealthy (HTTP ${code:-unavailable})"
  python3 "$POLICY_TOOL" verify-manifest "$manifest"

  api_get >"$current"
  python3 "$POLICY_TOOL" prepare-mediafusion "$current" "$payload"
  python3 "$POLICY_TOOL" prepare-put "$current" "$rollback"
  code="$(api_put_payload "$payload" "$response" || true)"
  if [[ "$code" != "200" ]]; then
    rollback_code="$(api_put_payload "$rollback" "$response" || true)"
    if [[ "$rollback_code" == "200" ]]; then
      die "MediaFusion enable PUT failed (HTTP ${code:-unavailable}); original AIOStreams user state restored"
    fi
    die "MediaFusion enable PUT failed (HTTP ${code:-unavailable}) and automatic rollback failed (HTTP ${rollback_code:-unavailable})"
  fi

  if ! api_get >"$readback" \
    || ! python3 "$POLICY_TOOL" verify-mediafusion "$readback" \
    || ! verify_policy; then
    rollback_code="$(api_put_payload "$rollback" "$response" || true)"
    if [[ "$rollback_code" == "200" ]]; then
      die "MediaFusion readback failed; original AIOStreams user state restored"
    fi
    die "MediaFusion readback failed and automatic rollback failed (HTTP $rollback_code)"
  fi
  verify_policy
)

set_tvdb_key() (
  set -euo pipefail
  local tmpdir current key_file payload rollback response readback code rollback_code tvdb_key
  tmpdir="$(secure_tmpdir)"
  trap 'rm -rf "$tmpdir"' EXIT
  current="$tmpdir/current.json"
  key_file="$tmpdir/tvdb.key"
  payload="$tmpdir/tvdb-payload.json"
  rollback="$tmpdir/rollback-payload.json"
  response="$tmpdir/response.json"
  readback="$tmpdir/readback.json"

  if [[ -t 0 ]]; then
    read -r -s -p "TVDB API key: " tvdb_key
    echo >&2
  else
    IFS= read -r tvdb_key || die "TVDB API key must be supplied on stdin"
  fi
  [[ -n "$tvdb_key" ]] || die "TVDB API key must not be empty"
  printf '%s' "$tvdb_key" >"$key_file"
  chmod 600 "$key_file"
  unset tvdb_key

  api_get >"$current"
  python3 "$POLICY_TOOL" prepare-tvdb "$current" "$key_file" "$payload"
  python3 "$POLICY_TOOL" prepare-put "$current" "$rollback"
  code="$(api_put_payload "$payload" "$response" || true)"
  if [[ "$code" != "200" ]]; then
    rollback_code="$(api_put_payload "$rollback" "$response" || true)"
    if [[ "$rollback_code" == "200" ]]; then
      die "TVDB credential update failed validation (HTTP ${code:-unavailable}); original user state restored"
    fi
    die "TVDB credential update failed (HTTP ${code:-unavailable}) and automatic rollback failed (HTTP ${rollback_code:-unavailable})"
  fi

  if ! api_get >"$readback" \
    || ! python3 "$POLICY_TOOL" verify-tvdb "$readback" "$key_file" \
    || ! verify_policy; then
    rollback_code="$(api_put_payload "$rollback" "$response" || true)"
    if [[ "$rollback_code" == "200" ]]; then
      die "TVDB credential readback failed; original user state restored"
    fi
    die "TVDB credential readback failed and automatic rollback failed (HTTP $rollback_code)"
  fi
  echo "TVDB metadata integration configured and verified (value hidden)"
)

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
    apply_target_patch
    ;;
  enable-mediafusion)
    load_creds
    [[ -f "$POLICY_TOOL" ]] || die "missing policy tool $POLICY_TOOL"
    enable_mediafusion
    ;;
  set-tvdb-key)
    load_creds
    [[ -f "$POLICY_TOOL" ]] || die "missing policy tool $POLICY_TOOL"
    set_tvdb_key
    ;;
  verify)
    load_creds
    verify_policy
    ;;
  *)
    cat <<EOF
Usage: $(basename "$0") <get|diff|apply|enable-mediafusion|set-tvdb-key|verify>

  get    Download full user config (contains secrets — do not commit)
  diff   Show only changed keys vs target patch (credential values hidden)
  apply  Merge patch and PUT via private temporary files (response hidden)
  enable-mediafusion
         Validate the public base manifest, enable the AIO-native cached-only
         MediaFusion integration, wire provider groups, read back, or roll back
  set-tvdb-key
         Read one TVDB API key from stdin/hidden prompt, validate it through
         AIOStreams, read back the exact value without printing it, or roll back
  verify Assert the live stream topology/policy without printing credentials

Env: MANGO_AIOSTREAMS_URL, MANGO_AIOSTREAMS_CREDS, MANGO_AIOSTREAMS_PATCH
EOF
    exit 1
    ;;
esac
