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

apply_profile_to() {
  local base_url="$1"
  local creds_file="$2"
  local profile_arg="${3:-}"

  [[ -f "$PROFILES" ]] || die "missing $PROFILES — run: $0 init-profiles"
  curl -sf --max-time 5 "${base_url}/health" >/dev/null 2>&1 \
    || die "NexoTV down at $base_url"

  local pid resolved tmp out token manifest_url mode
  PROFILE_ID="$profile_arg"
  pid="$(resolve_profile_id)"
  tmp="$(mktemp)"
  python3 - "$PROFILES" "$pid" >"$tmp" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
pid = sys.argv[2]
cfg = data["profiles"][pid]["config"]
json.dump(cfg, sys.stdout)
PY

  out="$(python3 "$SCRIPT_DIR/lib/nexotv_token.py" "$tmp" --base-url "$base_url")"
  rm -f "$tmp"
  token="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
  manifest_url="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["manifest_url"])')"
  mode="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["mode"])')"

  mkdir -p "$(dirname "$creds_file")"
  cat >"$creds_file" <<EOF
# mango NexoTV — generated $(date -Iseconds)
NEXOTV_PROFILE_ID='$pid'
NEXOTV_TOKEN='$token'
NEXOTV_MANIFEST_URL='$manifest_url'
NEXOTV_TOKEN_MODE='$mode'
EOF
  chmod 600 "$creds_file"
  echo "applied profile: $pid @ $base_url (token mode: $mode)"
  echo "manifest: $manifest_url"
}

apply_profile() {
  nexotv_health_ok || die "NexoTV down at $BASE_URL — run: bash scripts/phase-live/install-nexotv.sh"
  apply_profile_to "$BASE_URL" "$CREDS" "${PROFILE_ID:-}"
}

apply_free() {
  local free_base free_creds
  free_base="$(nexotv_free_base_url)"
  free_creds="$(nexotv_free_credentials_file)"
  nexotv_free_health_ok || die "NexoTV free down at $free_base — run: bash scripts/phase-live/install-nexotv-free.sh"
  apply_profile_to "$free_base" "$free_creds" "${PROFILE_ID:-iptv-org-sports}"
}

wire_export() {
  nexotv_load_credentials || die "missing paid credentials — run: $0 apply-area69"
  [[ -f "$EXPORT" ]] || cp "${REPO_DIR}/config/stremio-export.example.json" "$EXPORT"

  local paid_manifest="$NEXOTV_MANIFEST_URL"
  local free_manifest=""
  if nexotv_load_free_credentials 2>/dev/null; then
    free_manifest="$NEXOTV_MANIFEST_URL"
  fi

  python3 - "$EXPORT" "$paid_manifest" "$free_manifest" <<'PY'
import json, sys
path, paid_manifest, free_manifest = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(path, encoding="utf-8"))
addons = data.get("addons") or []
addons = [a for a in addons if a.get("name") not in ("NexoTV", "NexoTV Free")]
addons.append({"name": "NexoTV", "manifestUrl": paid_manifest})
if free_manifest:
    addons.append({"name": "NexoTV Free", "manifestUrl": free_manifest})
data["addons"] = addons
json.dump(data, open(path, "w", encoding="utf-8"), indent=2)
print(f"wired NexoTV manifests into {path} (free={'yes' if free_manifest else 'no'})")
PY
}

nexotv_load_free_credentials() {
  local creds
  creds="$(nexotv_free_credentials_file)"
  [[ -f "$creds" ]] || return 1
  # shellcheck disable=SC1090
  source "$creds"
  [[ -n "${NEXOTV_TOKEN:-}" && -n "${NEXOTV_MANIFEST_URL:-}" ]]
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
    "catalogName": "mango Live TV",
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
  apply-free) PROFILE_ID="${2:-iptv-org-sports}"; apply_free ;;
  apply-area69) apply_area69 ;;
  wire-export) wire_export ;;
  manifest) print_manifest ;;
  *)
    die "usage: $0 {init-profiles|list-profiles|apply [profile]|apply-free [profile]|apply-area69|wire-export|manifest}"
    ;;
esac
