#!/usr/bin/env bash
# Install personal YouTube API keys from a local secrets file (not in git).
# Run on the Pi: bash scripts/phase0/set-youtube-api-keys.sh
#
# 1. killall kodi
# 2. Create ~/.config/mango/youtube-api.json (see youtube-api.json.example)
# 3. bash scripts/phase0/set-youtube-api-keys.sh
# 4. bash scripts/phase0/launch-kodi.sh → YouTube → Sign in

set -euo pipefail

SECRETS="${HOME}/.config/mango/youtube-api.json"
ADDON_DATA="${HOME}/.kodi/userdata/addon_data/plugin.video.youtube"
TARGET="${ADDON_DATA}/api_keys.json"

if [[ ! -f "$SECRETS" ]]; then
  echo "! Missing ${SECRETS}"
  echo
  mkdir -p "$(dirname "$SECRETS")"
  cat >"${SECRETS}.example" <<'EOF'
{
  "api_key": "AIza...",
  "client_id": "123456789-xxxx.apps.googleusercontent.com",
  "client_secret": "GOCSPX-..."
}
EOF
  echo "Created ${SECRETS}.example — copy to youtube-api.json and fill in values:"
  echo "  cp ${SECRETS}.example ${SECRETS}"
  echo "  nano ${SECRETS}"
  exit 1
fi

if pgrep -x kodi >/dev/null 2>&1 || pgrep -x kodi.bin >/dev/null 2>&1; then
  echo "Stopping Kodi (keys must be written while Kodi is off)..."
  killall kodi kodi.bin 2>/dev/null || true
  sleep 2
fi

mkdir -p "$ADDON_DATA"

python3 <<PY
import json, os, sys

secrets_path = os.path.expanduser("${SECRETS}")
with open(secrets_path) as f:
    s = json.load(f)

for key in ("api_key", "client_id", "client_secret"):
    if not s.get(key, "").strip():
        sys.exit(f"! {key} is empty in {secrets_path}")

client_id = s["client_id"].strip()
# Method 3 wiki: strip suffix if present
if client_id.endswith(".apps.googleusercontent.com"):
    client_id = client_id.removesuffix(".apps.googleusercontent.com")

out = {
    "keys": {
        "developer": {},
        "personal": {
            "api_key": s["api_key"].strip(),
            "client_id": client_id,
            "client_secret": s["client_secret"].strip(),
        },
    }
}

target = os.path.expanduser("${TARGET}")
with open(target, "w") as f:
    json.dump(out, f, indent=4)
    f.write("\n")

print(f"✓ Wrote {target}")
print("  Clear any API fields in YouTube addon GUI if you entered old keys there.")
print("  Next: bash scripts/phase0/launch-kodi.sh → YouTube → Sign in")
PY
