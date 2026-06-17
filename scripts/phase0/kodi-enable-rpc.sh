#!/usr/bin/env bash
# Enable Kodi JSON-RPC (HTTP port 8080) with username + password.
# Kodi must be stopped while config is edited.
#
# Usage:
#   bash scripts/phase0/kodi-enable-rpc.sh <username> <password>
#
# Then:
#   bash scripts/phase0/launch-kodi.sh
#   bash scripts/phase0/test-kodi-rpc.sh <username> <password>

set -euo pipefail

KODI_USERDATA="${HOME}/.kodi/userdata"
GUISETTINGS="${KODI_USERDATA}/guisettings.xml"
ADVANCED="${KODI_USERDATA}/advancedsettings.xml"
RPC_USER="${1:-}"
RPC_PASS="${2:-}"

if [[ -z "$RPC_USER" ]]; then
  read -r -p "Kodi RPC username [mango]: " RPC_USER
  RPC_USER="${RPC_USER:-mango}"
fi

if [[ -z "$RPC_PASS" ]]; then
  read -r -s -p "Kodi RPC password (required): " RPC_PASS
  echo
fi

if [[ -z "$RPC_PASS" ]]; then
  echo "Error: password cannot be empty."
  exit 1
fi

if [[ ! -f "$GUISETTINGS" ]]; then
  echo "No guisettings.xml — launch Kodi once, quit, then re-run."
  exit 1
fi

echo "Stopping Kodi..."
killall kodi kodi.bin 2>/dev/null || true
sleep 2

cp -a "$GUISETTINGS" "${GUISETTINGS}.bak.$(date +%Y%m%d%H%M%S)"

python3 - "$GUISETTINGS" "$RPC_USER" "$RPC_PASS" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, user, password = sys.argv[1:4]

tree = ET.parse(path)
root = tree.getroot()

def set_setting(setting_id: str, value: str) -> None:
    for elem in root.iter("setting"):
        if elem.get("id") == setting_id:
            elem.text = value
            elem.attrib.pop("default", None)
            return
    parent = root.find(".//section[@id='services']")
    if parent is None:
        parent = root
    ET.SubElement(parent, "setting", id=setting_id).text = value

for sid, val in [
    ("services.webserver", "true"),
    ("services.webserverport", "8080"),
    ("services.webserverauthentication", "true"),
    ("services.webserverusername", user),
    ("services.webserverpassword", password),
    ("services.esenabled", "true"),
    ("services.esallinterfaces", "true"),
]:
    set_setting(sid, val)

tree.write(path, encoding="UTF-8", xml_declaration=True)
print(f"Patched guisettings: user={user!r} port=8080")
PY

# Belt-and-suspenders: advancedsettings enables webserver on boot
cat >"$ADVANCED" <<'EOF'
<advancedsettings>
  <services>
    <webserver>true</webserver>
    <webserverport>8080</webserverport>
    <esallinterfaces>true</esallinterfaces>
  </services>
</advancedsettings>
EOF

echo "Wrote ${ADVANCED}"
echo
echo "Verify guisettings:"
grep -E 'services.webserver|services.webserverpassword|services.webserverusername' "$GUISETTINGS" | head -5
echo
echo "Next:"
echo "  bash scripts/phase0/launch-kodi.sh"
echo "  sleep 5"
echo "  bash scripts/phase0/test-kodi-rpc.sh ${RPC_USER} '<password>'"
