#!/usr/bin/env bash
# Headless NexoTV configure — IPTV-org / M3U / Xtream profiles + stremio-export wire.
#
# Usage:
#   bash scripts/phase-live/nexotv-config.sh init-profiles
#   bash scripts/phase-live/nexotv-config.sh apply [profile-id]
#   bash scripts/phase-live/nexotv-config.sh list-profiles
#   bash scripts/phase-live/nexotv-config.sh wire-export
#   bash scripts/phase-live/nexotv-config.sh manifest
#
# Credentials: ~/.config/mango/nexotv.credentials

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib/nexotv.sh
source "$SCRIPT_DIR/lib/nexotv.sh"

BASE_URL="$(nexotv_base_url)"
PROFILES="$(nexotv_profiles_file)"
CREDS="$(nexotv_credentials_file)"
EXPORT="$(nexotv_export_file)"
EXAMPLE="${REPO_DIR}/config/nexotv-profiles.example.json"

die() { echo "nexotv-config: $*" >&2; exit 1; }

cmd="${1:-apply}"
PROFILE_ID="${2:-}"

init_profiles() {
  mkdir -p "$(dirname "$PROFILES")"
  if [[ -f "$PROFILES" ]]; then
    echo "profiles already exist: $PROFILES"
    return 0
  fi
  cp "$EXAMPLE" "$PROFILES"
  echo "created $PROFILES from example"
}

list_profiles() {
  [[ -f "$PROFILES" ]] || die "missing $PROFILES — run: $0 init-profiles"
  python3 - "$PROFILES" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
default = data.get("default_profile", "")
for pid, row in (data.get("profiles") or {}).items():
    mark = " (default)" if pid == default else ""
    print(f"  {pid}{mark}: {row.get('label', pid)}")
PY
}

resolve_profile_id() {
  python3 - "$PROFILES" "${PROFILE_ID:-}" <<'PY'
import json, sys
path, arg = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding="utf-8"))
profiles = data.get("profiles") or {}
pid = arg or data.get("default_profile") or ""
if pid not in profiles:
    raise SystemExit(f"unknown profile {pid!r} — choose from: {', '.join(profiles)}")
print(pid)
PY
}

apply_profile() {
  [[ -f "$PROFILES" ]] || die "missing $PROFILES — run: $0 init-profiles"
  nexotv_health_ok || die "NexoTV down at $BASE_URL — run: bash scripts/phase-live/install-nexotv.sh"

  local pid resolved tmp out token manifest_url mode
  pid="$(resolve_profile_id)"
  tmp="$(mktemp)"
  python3 - "$PROFILES" "$pid" >"$tmp" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
pid = sys.argv[2]
cfg = data["profiles"][pid]["config"]
json.dump(cfg, sys.stdout)
PY

  out="$(python3 "$SCRIPT_DIR/lib/nexotv_token.py" "$tmp" --base-url "$BASE_URL")"
  rm -f "$tmp"
  token="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
  manifest_url="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["manifest_url"])')"
  mode="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["mode"])')"

  mkdir -p "$(dirname "$CREDS")"
  cat >"$CREDS" <<EOF
# mango NexoTV — generated $(date -Iseconds)
NEXOTV_PROFILE_ID='$pid'
NEXOTV_TOKEN='$token'
NEXOTV_MANIFEST_URL='$manifest_url'
NEXOTV_TOKEN_MODE='$mode'
EOF
  chmod 600 "$CREDS"
  echo "applied profile: $pid (token mode: $mode)"
  echo "manifest: $manifest_url"
}

wire_export() {
  nexotv_load_credentials || die "missing credentials — run: $0 apply"
  [[ -f "$EXPORT" ]] || cp "${REPO_DIR}/config/stremio-export.example.json" "$EXPORT"

  python3 - "$EXPORT" "$NEXOTV_MANIFEST_URL" <<'PY'
import json, sys
path, manifest = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding="utf-8"))
addons = data.get("addons") or []
addons = [a for a in addons if a.get("name") != "NexoTV"]
addons.append({"name": "NexoTV", "manifestUrl": manifest})
data["addons"] = addons
json.dump(data, open(path, "w", encoding="utf-8"), indent=2)
data["_comment"] = data.get("_comment") or "mango stremio-export — never commit secrets"
print(f"wired NexoTV manifest into {path}")
PY
}

print_manifest() {
  nexotv_load_credentials || die "missing credentials"
  curl -sf --max-time 30 "$NEXOTV_MANIFEST_URL" | python3 -m json.tool
}

apply_area69() {
  local creds="${MANGO_AREA69_CREDS:-${HOME}/.config/mango/area69.credentials}"
  [[ -f "$creds" ]] || die "missing $creds — cp config/area69.credentials.example and fill in Xtream details"

  # shellcheck disable=SC1090
  source "$creds"
  export XTREAM_URL XTREAM_USER XTREAM_PASS EPG_URL
  [[ -n "${XTREAM_URL:-}" && -n "${XTREAM_USER:-}" && -n "${XTREAM_PASS:-}" ]] \
    || die "$creds must set XTREAM_URL, XTREAM_USER, XTREAM_PASS"

  nexotv_health_ok || die "NexoTV down at $BASE_URL — run: bash scripts/phase-live/install-nexotv.sh"

  local tmp out token manifest_url mode
  tmp="$(mktemp)"
  python3 - "$tmp" <<PY
import json, os
cfg = {
    "provider": "xtream",
    "xtreamUrl": os.environ["XTREAM_URL"].strip(),
    "xtreamUsername": os.environ["XTREAM_USER"].strip(),
    "xtreamPassword": os.environ["XTREAM_PASS"].strip(),
    "enableEpg": True,
    "reformatLogos": True,
    "catalogName": "AREA69 Live",
}
epg = os.environ.get("EPG_URL", "").strip()
if epg:
    cfg["epgUrl"] = epg
json.dump(cfg, open("$tmp", "w", encoding="utf-8"))
PY

  out="$(python3 "$SCRIPT_DIR/lib/nexotv_token.py" "$tmp" --base-url "$BASE_URL")"
  rm -f "$tmp"
  token="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
  manifest_url="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["manifest_url"])')"
  mode="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["mode"])')"

  mkdir -p "$(dirname "$CREDS")"
  cat >"$CREDS" <<EOF
# mango NexoTV — AREA69 $(date -Iseconds)
NEXOTV_PROFILE_ID='area69-xtream'
NEXOTV_TOKEN='$token'
NEXOTV_MANIFEST_URL='$manifest_url'
NEXOTV_TOKEN_MODE='$mode'
EOF
  chmod 600 "$CREDS"
  echo "applied AREA69 Xtream profile (token mode: $mode)"
  echo "manifest: $manifest_url"
}

case "$cmd" in
  init-profiles) init_profiles ;;
  list-profiles) list_profiles ;;
  apply) apply_profile ;;
  apply-area69) apply_area69 ;;
  wire-export) wire_export ;;
  manifest) print_manifest ;;
  *)
    die "usage: $0 {init-profiles|list-profiles|apply [profile]|apply-area69|wire-export|manifest}"
    ;;
esac
