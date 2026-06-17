#!/usr/bin/env bash
# Enable Kodi JSON-RPC (HTTP port 8080) with username + password.
# Kodi must be stopped while guisettings.xml is edited.
#
# Usage:
#   bash scripts/phase0/kodi-enable-rpc.sh <username> <password>
#   bash scripts/phase0/kodi-enable-rpc.sh              # prompts for both
#
# Then: bash scripts/phase0/test-kodi-rpc.sh <username> <password>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUISETTINGS="${HOME}/.kodi/userdata/guisettings.xml"
RPC_USER="${1:-}"
RPC_PASS="${2:-}"

if [[ -z "$RPC_USER" ]]; then
  read -r -p "Kodi RPC username [mango]: " RPC_USER
  RPC_USER="${RPC_USER:-mango}"
fi

if [[ -z "$RPC_PASS" ]]; then
  read -r -s -p "Kodi RPC password (required, min 1 char): " RPC_PASS
  echo
fi

if [[ -z "$RPC_PASS" ]]; then
  echo "Error: password cannot be empty when web server auth is enabled."
  exit 1
fi

if [[ ! -f "$GUISETTINGS" ]]; then
  echo "No ~/.kodi/userdata/guisettings.xml — launch Kodi once, quit, then re-run."
  exit 1
fi

echo "Stopping Kodi..."
killall kodi kodi.bin 2>/dev/null || true
sleep 2

python3 - "$GUISETTINGS" "$RPC_USER" "$RPC_PASS" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, user, password = sys.argv[1:4]

tree = ET.parse(path)
root = tree.getroot()

# Find or create services section
section = root.find(".//section[@id='services']")
if section is None:
    section = ET.SubElement(root, "section", id="services")

def set_setting(setting_id: str, value: str) -> None:
    for elem in section.iter("setting"):
        if elem.get("id") == setting_id:
            elem.text = value
            if "default" in elem.attrib:
                del elem.attrib["default"]
            return
    elem = ET.SubElement(section, "setting", id=setting_id)
    elem.text = value

set_setting("services.webserver", "true")
set_setting("services.webserverport", "8080")
set_setting("services.webserverauthentication", "true")
set_setting("services.webserverusername", user)
set_setting("services.webserverpassword", password)
set_setting("services.esenabled", "true")

tree.write(path, encoding="UTF-8", xml_declaration=True)
print(f"Kodi RPC: user={user!r} port=8080 (password set)")
PY

echo
echo "Launch Kodi, then test:"
echo "  bash scripts/phase0/launch-kodi.sh"
echo "  bash scripts/phase0/test-kodi-rpc.sh ${RPC_USER} '<password>'"
