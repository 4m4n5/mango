#!/usr/bin/env bash
# Headless AIOMetadata config — import export JSON, wire stremio-export.
#
# Usage:
#   bash scripts/m4-addons/aiometadata-config.sh import [export.json]
#   bash scripts/m4-addons/aiometadata-config.sh manifest
#   bash scripts/m4-addons/aiometadata-config.sh wire-export
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

post_config_save() (
  set -euo pipefail
  local config_tmp="$1"
  local password="${2:-}"
  local existing_uuid="${3:-}"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  if [[ -z "$password" && -f "$CREDS" ]]; then
    # shellcheck disable=SC1090
    source "$CREDS"
    password="${password:-${AIOMETADATA_PASSWORD:-}}"
    existing_uuid="${existing_uuid:-${AIOMETADATA_UUID:-}}"
  fi
  [[ -n "$password" ]] || die "AIOMETADATA_PASSWORD required"

  local payload http_code response_tmp
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

  response_tmp="$tmp_dir/save-response.json"
  if ! http_code="$(printf '%s' "$payload" | curl -sS --connect-timeout 5 --max-time 30 -w '%{http_code}' -o "$response_tmp" \
      -H "Content-Type: application/json" -X POST -d @- "$BASE_URL/api/config/save")"; then
    die "POST /api/config/save failed (curl)"
  fi
  if [[ "$http_code" != "200" ]]; then
    die "POST /api/config/save failed (HTTP $http_code)"
  fi

  mkdir -p "$(dirname "$CREDS")"
  AIOMETADATA_PASSWORD_OUT="$password" python3 - "$response_tmp" "$CREDS" <<'PY'
import json, os, shlex, sys, tempfile
from pathlib import Path

resp = json.load(open(sys.argv[1], encoding="utf-8"))
creds_path = sys.argv[2]
password = os.environ["AIOMETADATA_PASSWORD_OUT"]
uuid = resp["userUUID"]
manifest = resp.get("installUrl") or ""
lines = [
    f"AIOMETADATA_UUID={shlex.quote(uuid)}",
    f"AIOMETADATA_PASSWORD={shlex.quote(password)}",
    f"AIOMETADATA_MANIFEST_URL={shlex.quote(manifest)}",
]
creds = Path(creds_path)
creds.parent.mkdir(parents=True, exist_ok=True)
fd, tmp_path = tempfile.mkstemp(prefix=f".{creds.name}.", suffix=".tmp", dir=creds.parent)
tmp = Path(tmp_path)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, creds)
    dir_fd = os.open(creds.parent, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
finally:
    try:
        tmp.unlink()
    except FileNotFoundError:
        pass
print(f"saved {creds_path}")
if manifest:
    print("manifest saved")
PY
)

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

cmd_check() (
  set -euo pipefail
  local import_path="${1:-${MANGO_AIOMETADATA_IMPORT:-}}"
  [[ -n "$import_path" && -f "$import_path" ]] || die "export file required"
  local catalog_yaml="${MANGO_CATALOG_YAML:-$REPO_DIR/config/catalog.example.yaml}"
  local tmp_dir manifest_tmp
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT
  if aiometadata_manifest_ok 2>/dev/null; then
    manifest_tmp="$tmp_dir/manifest.json"
    curl -sf --max-time 10 "$(aiometadata_manifest_url)" >"$manifest_tmp" \
      || die "failed to fetch live AIOMetadata manifest"
    python3 "$SCRIPT_DIR/lib/aiometadata_mango.py" check "$import_path" "$catalog_yaml" "$manifest_tmp"
    return
  fi
  python3 "$SCRIPT_DIR/lib/aiometadata_mango.py" check "$import_path" "$catalog_yaml"
)

cmd_import() (
  set -euo pipefail
  local import_path="${1:-${MANGO_AIOMETADATA_IMPORT:-}}"
  [[ -n "$import_path" && -f "$import_path" ]] || die "import file required (arg or MANGO_AIOMETADATA_IMPORT)"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

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

  local config_tmp
  config_tmp="$tmp_dir/config.json"
  prepare_config "$import_path" >"$config_tmp" || {
    local rc=$?
    [[ $rc -eq 2 ]] && die "export missing catalogs required by catalog.yaml"
    exit "$rc"
  }
  post_config_save "$config_tmp" "$password" "$existing_uuid"
)

cmd_manifest() {
  load_creds
  echo "$AIOMETADATA_MANIFEST_URL"
}

cmd_wire_export() {
  load_creds
  [[ -f "$EXPORT_FILE" ]] || die "missing $EXPORT_FILE"
  if [[ ! -w "$EXPORT_FILE" ]] && ! sudo -n true 2>/dev/null; then
    die "$EXPORT_FILE not writable — run: sudo bash $0 wire-export"
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

cmd_ensure_catalogs() (
  set -euo pipefail
  local import_path="${1:-${MANGO_AIOMETADATA_IMPORT:-}}"
  shift || true
  [[ -n "$import_path" && -f "$import_path" ]] || die "export file required for ensure-catalogs"
  local catalog_yaml="${MANGO_CATALOG_YAML:-$REPO_DIR/config/catalog.example.yaml}"
  local mango_py="$SCRIPT_DIR/lib/aiometadata_mango.py"
  local tmp_dir config_tmp
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT
  config_tmp="$tmp_dir/config.json"
  python3 "$mango_py" ensure "$import_path" "$catalog_yaml" "$@" >"$config_tmp" \
    || die "ensure catalog synthesis failed"
  post_config_save "$config_tmp"
  echo "ensure-catalogs ok${*:+: $*}"
)

cmd_sync_rails() (
  set -euo pipefail
  local import_path="${1:-${MANGO_AIOMETADATA_IMPORT:-$HOME/.config/mango/aiometadata-import.json}}"
  [[ -n "$import_path" && -f "$import_path" ]] || die "export file required for sync-rails (arg or MANGO_AIOMETADATA_IMPORT)"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  if ! aiometadata_health_ok; then
    echo "aiometadata-config: skip sync-rails — AIOMetadata not reachable at $(aiometadata_health_url)"
    return 0
  fi
  [[ -f "$CREDS" ]] || die "missing $CREDS — run import first"

  local catalog_yaml="${MANGO_CATALOG_YAML:-$REPO_DIR/config/catalog.example.yaml}"
  local mango_py="$SCRIPT_DIR/lib/aiometadata_mango.py"
  local manifest_tmp missing_ids

  if ! aiometadata_manifest_ok 2>/dev/null; then
    echo "aiometadata-config: manifest unreachable — full rail sync"
    cmd_import "$import_path"
    cmd_wire_export
    return 0
  fi

  manifest_tmp="$tmp_dir/manifest.json"
  curl -sf --max-time 15 "$(aiometadata_manifest_url)" >"$manifest_tmp" \
    || die "failed to fetch live AIOMetadata manifest"

  missing_ids="$(python3 "$mango_py" missing "$import_path" "$catalog_yaml" "$manifest_tmp" || true)"
  if [[ -z "$missing_ids" ]]; then
    echo "aiometadata-config: rail catalogs in sync with manifest"
    return 0
  fi

  echo "aiometadata-config: syncing missing rail catalogs:"
  while IFS= read -r catalog_id; do
    [[ -n "$catalog_id" ]] && echo "  + $catalog_id"
  done <<<"$missing_ids"

  local config_tmp
  config_tmp="$tmp_dir/config.json"
  prepare_config "$import_path" >"$config_tmp" || die "prepare mango config failed"
  post_config_save "$config_tmp"
  cmd_wire_export
  echo "aiometadata-config: sync-rails ok"
)

cmd="${1:-}"
shift || true
case "$cmd" in
  import) cmd_import "$@" ;;
  check) cmd_check "$@" ;;
  manifest) cmd_manifest ;;
  wire-export) cmd_wire_export ;;
  ensure-catalogs) cmd_ensure_catalogs "$@" ;;
  sync-rails) cmd_sync_rails "$@" ;;
  *)
    cat <<EOF
Usage: $(basename "$0") <import|check|manifest|wire-export|ensure-catalogs|sync-rails> [export.json] [ids...]

  import           Import configure export → AIOMetadata (mango rail catalogs only)
  check            Compare export/manifest vs catalog.yaml mdblist rails
  manifest         Print manifest URL from credentials
  wire-export      Replace AIOLists with AIOMetadata in $EXPORT_FILE
  ensure-catalogs  Rebuild mango rail catalogs in AIOMetadata and save
  sync-rails       Auto-detect missing manifest catalogs vs rails; sync + wire-export

Env: MANGO_AIOMETADATA_URL, MANGO_AIOMETADATA_IMPORT, MANGO_AIOMETADATA_PASSWORD
     MANGO_AIOMETADATA_IMPORT_MODE=mango|exact|minimal  (default: mango)
     MANGO_CATALOG_YAML — rail source of truth (default: config/catalog.example.yaml)
EOF
    exit 1
    ;;
esac
