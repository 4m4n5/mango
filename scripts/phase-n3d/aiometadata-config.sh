#!/usr/bin/env bash
# Headless AIOMetadata config — import export JSON, wire stremio-export.
#
# Usage:
#   bash scripts/phase-n3d/aiometadata-config.sh import [export.json]
#   bash scripts/phase-n3d/aiometadata-config.sh manifest
#   bash scripts/phase-n3d/aiometadata-config.sh wire-export
#
# Credentials: ~/.config/mango/aiometadata.credentials
# Env: MANGO_AIOMETADATA_URL, MANGO_AIOMETADATA_IMPORT, MANGO_AIOMETADATA_PASSWORD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib/aiometadata.sh
source "$SCRIPT_DIR/lib/aiometadata.sh"
BASE_URL="${MANGO_AIOMETADATA_URL:-http://127.0.0.1:3036}"
CREDS="${MANGO_AIOMETADATA_CREDS:-$HOME/.config/mango/aiometadata.credentials}"
EXPORT_FILE="${MANGO_STREMIO_EXPORT:-/etc/mango/stremio-export.json}"

die() { echo "aiometadata-config: $*" >&2; exit 1; }

load_creds() {
  [[ -f "$CREDS" ]] || die "missing $CREDS — run import first"
  # shellcheck disable=SC1090
  source "$CREDS"
  [[ -n "${AIOMETADATA_UUID:-}" && -n "${AIOMETADATA_PASSWORD:-}" && -n "${AIOMETADATA_MANIFEST_URL:-}" ]] \
    || die "AIOMETADATA_UUID, AIOMETADATA_PASSWORD, AIOMETADATA_MANIFEST_URL required in $CREDS"
}

prepare_config() {
  local import_path="$1"
  local mode="${MANGO_AIOMETADATA_IMPORT_MODE:-mango}"
  local mango_py="$SCRIPT_DIR/lib/aiometadata_mango.py"
  local catalog_yaml="${MANGO_CATALOG_YAML:-$REPO_DIR/config/catalog.example.yaml}"

  if [[ "$mode" == "mango" ]]; then
    python3 "$mango_py" build "$import_path" "$catalog_yaml" "$REPO_DIR/deploy/aiometadata/.env"
    return
  fi

  python3 - "$import_path" "$REPO_DIR/deploy/aiometadata/.env" "$mode" <<'PY'
import json
import os
import sys

export_path, env_path, mode = sys.argv[1], sys.argv[2], sys.argv[3]
raw = json.load(open(export_path, encoding="utf-8"))
config = raw.get("config") or raw
if not isinstance(config, dict):
    raise SystemExit("export missing config object")

# Deep copy — preserve export settings verbatim.
config = json.loads(json.dumps(config))

env_keys = {}
if os.path.isfile(env_path):
    for line in open(env_path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env_keys[key.strip()] = value.strip()

api = config.setdefault("apiKeys", {})

if mode == "exact":
    # Self-host only: TMDB required by save API when ElfHosted built-in is absent.
    if not str(api.get("tmdb") or "").strip():
        tmdb = (
            env_keys.get("TMDB_API_KEY", "").strip()
            or env_keys.get("BUILT_IN_TMDB_API_KEY", "").strip()
        )
        if tmdb:
            api["tmdb"] = tmdb
    api["hasBuiltInTmdb"] = False
    api["hasBuiltInTvdb"] = False
    # Drop hosted-instance marketing from configure UI.
    if api.get("customDescriptionBlurb", "").find("elfhosted.com") >= 0:
        api["customDescriptionBlurb"] = ""
else:
    api["customDescriptionBlurb"] = ""
    mdblist = str(api.get("mdblist") or "").strip()
    if not mdblist:
        mdblist = env_keys.get("MDBLIST_API_KEY", "").strip()
        if mdblist:
            api["mdblist"] = mdblist

print(json.dumps(config))
PY
}

cmd_check() {
  local import_path="${1:-${MANGO_AIOMETADATA_IMPORT:-}}"
  [[ -n "$import_path" && -f "$import_path" ]] || die "export file required"
  local catalog_yaml="${MANGO_CATALOG_YAML:-$REPO_DIR/config/catalog.example.yaml}"
  local manifest_tmp=""
  if aiometadata_manifest_ok 2>/dev/null; then
    manifest_tmp="$(mktemp)"
    curl -sf --max-time 10 "$(aiometadata_manifest_url)" >"$manifest_tmp"
    python3 "$SCRIPT_DIR/lib/aiometadata_mango.py" check "$import_path" "$catalog_yaml" "$manifest_tmp"
    local rc=$?
    rm -f "$manifest_tmp"
    return "$rc"
  fi
  python3 "$SCRIPT_DIR/lib/aiometadata_mango.py" check "$import_path" "$catalog_yaml"
}

cmd_import() {
  local import_path="${1:-${MANGO_AIOMETADATA_IMPORT:-}}"
  [[ -n "$import_path" && -f "$import_path" ]] || die "import file required (arg or MANGO_AIOMETADATA_IMPORT)"

  local password="${MANGO_AIOMETADATA_PASSWORD:-}"
  local existing_uuid=""
  if [[ -f "$CREDS" ]]; then
    # shellcheck disable=SC1090
    source "$CREDS"
    password="${password:-${AIOMETADATA_PASSWORD:-}}"
    existing_uuid="${AIOMETADATA_UUID:-}"
  fi
  if [[ -z "$password" ]]; then
    password="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(16))
PY
)"
  fi

  local config_tmp payload http_code
  config_tmp="$(mktemp)"
  trap 'rm -f "$config_tmp"' RETURN
  prepare_config "$import_path" >"$config_tmp" || {
    local rc=$?
    [[ $rc -eq 2 ]] && die "export missing catalogs required by catalog.yaml"
    exit "$rc"
  }
  payload="$(AIOMETADATA_PASSWORD="$password" AIOMETADATA_UUID="$existing_uuid" python3 - "$config_tmp" <<'PY'
import json, os, sys
config = json.load(open(sys.argv[1], encoding="utf-8"))
body = {"config": config, "password": os.environ["AIOMETADATA_PASSWORD"]}
uuid = os.environ.get("AIOMETADATA_UUID", "").strip()
if uuid:
    body["userUUID"] = uuid
print(json.dumps(body))
PY
)"

  http_code="$(printf '%s' "$payload" | curl -s -w '%{http_code}' -o /tmp/aiometadata-save.json \
    -H "Content-Type: application/json" -X POST -d @- "$BASE_URL/api/config/save")"
  if [[ "$http_code" != "200" ]]; then
    cat /tmp/aiometadata-save.json >&2
    die "POST /api/config/save failed (HTTP $http_code)"
  fi

  mkdir -p "$(dirname "$CREDS")"
  python3 - /tmp/aiometadata-save.json "$CREDS" "$password" <<'PY'
import json, sys
resp = json.load(open(sys.argv[1], encoding="utf-8"))
creds_path, password = sys.argv[2], sys.argv[3]
uuid = resp["userUUID"]
manifest = resp.get("installUrl") or ""
lines = [
    f"AIOMETADATA_UUID={uuid}",
    f"AIOMETADATA_PASSWORD={password}",
    f"AIOMETADATA_MANIFEST_URL={manifest}",
]
open(creds_path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
import os
os.chmod(creds_path, 0o600)
print(f"saved {creds_path}")
print(f"manifest: {manifest}")
PY
}

cmd_manifest() {
  load_creds
  echo "$AIOMETADATA_MANIFEST_URL"
}

cmd_wire_export() {
  load_creds
  [[ -f "$EXPORT_FILE" ]] || die "missing $EXPORT_FILE"
  if [[ ! -w "$EXPORT_FILE" ]] && ! sudo -n true 2>/dev/null; then
    die "$EXPORT_FILE not writable — run on Pi as owner or with sudo"
  fi
  run_wire() {
    python3 - "$EXPORT_FILE" "$AIOMETADATA_MANIFEST_URL" <<'PY'
import json, sys
path, manifest = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding="utf-8"))
addons = [a for a in data.get("addons", []) if a.get("name") not in ("AIOLists", "AIOMetadata")]
addons.append({"name": "AIOMetadata", "manifestUrl": manifest})
data["addons"] = addons
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print("updated", path)
print("addons:", [a.get("name") for a in addons])
PY
  }
  if [[ -w "$EXPORT_FILE" ]]; then
    run_wire
  else
    sudo python3 - "$EXPORT_FILE" "$AIOMETADATA_MANIFEST_URL" <<'PY'
import json, sys
path, manifest = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding="utf-8"))
addons = [a for a in data.get("addons", []) if a.get("name") not in ("AIOLists", "AIOMetadata")]
addons.append({"name": "AIOMetadata", "manifestUrl": manifest})
data["addons"] = addons
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print("updated", path)
print("addons:", [a.get("name") for a in addons])
PY
  fi
}

cmd_ensure_catalogs() {
  [[ $# -gt 0 ]] || die "ensure-catalogs requires mdblist catalog ids"
  local import_path="${1:-${MANGO_AIOMETADATA_IMPORT:-}}"
  shift || true
  [[ -n "$import_path" && -f "$import_path" ]] || die "export file required for ensure-catalogs"
  local catalog_yaml="${MANGO_CATALOG_YAML:-$REPO_DIR/config/catalog.example.yaml}"
  local mango_py="$SCRIPT_DIR/lib/aiometadata_mango.py"
  local config_tmp payload http_code password existing_uuid
  config_tmp="$(mktemp)"
  trap 'rm -f "$config_tmp"' RETURN
  python3 "$mango_py" ensure "$import_path" "$@" >"$config_tmp" || die "ensure catalog synthesis failed"

  password="${MANGO_AIOMETADATA_PASSWORD:-}"
  existing_uuid=""
  if [[ -f "$CREDS" ]]; then
    # shellcheck disable=SC1090
    source "$CREDS"
    password="${password:-${AIOMETADATA_PASSWORD:-}}"
    existing_uuid="${AIOMETADATA_UUID:-}"
  fi
  [[ -n "$password" ]] || die "AIOMETADATA_PASSWORD required"

  payload="$(AIOMETADATA_PASSWORD="$password" AIOMETADATA_UUID="$existing_uuid" python3 - "$config_tmp" <<'PY'
import json, os, sys
config = json.load(open(sys.argv[1], encoding="utf-8"))
body = {"config": config, "password": os.environ["AIOMETADATA_PASSWORD"]}
uuid = os.environ.get("AIOMETADATA_UUID", "").strip()
if uuid:
    body["userUUID"] = uuid
print(json.dumps(body))
PY
)"

  http_code="$(printf '%s' "$payload" | curl -s -w '%{http_code}' -o /tmp/aiometadata-save.json \
    -H "Content-Type: application/json" -X POST -d @- "$BASE_URL/api/config/save")"
  if [[ "$http_code" != "200" ]]; then
    cat /tmp/aiometadata-save.json >&2
    die "POST /api/config/save failed (HTTP $http_code)"
  fi
  echo "ensure-catalogs ok: $*"
}

cmd="${1:-}"
shift || true
case "$cmd" in
  import) cmd_import "$@" ;;
  check) cmd_check "$@" ;;
  manifest) cmd_manifest ;;
  wire-export) cmd_wire_export ;;
  ensure-catalogs) cmd_ensure_catalogs "$@" ;;
  *)
    cat <<EOF
Usage: $(basename "$0") <import|check|manifest|wire-export|ensure-catalogs> [export.json] [ids...]

  import           Import configure export → AIOMetadata (mango rail catalogs only)
  check            Compare export/manifest vs catalog.yaml mdblist rails
  manifest         Print manifest URL from credentials
  wire-export      Replace AIOLists with AIOMetadata in $EXPORT_FILE
  ensure-catalogs  Add mdblist ids (plus reserve) to AIOMetadata import and save

Env: MANGO_AIOMETADATA_URL, MANGO_AIOMETADATA_IMPORT, MANGO_AIOMETADATA_PASSWORD
     MANGO_AIOMETADATA_IMPORT_MODE=mango|exact|minimal  (default: mango)
     MANGO_CATALOG_YAML — rail source of truth (default: config/catalog.example.yaml)
EOF
    exit 1
    ;;
esac
