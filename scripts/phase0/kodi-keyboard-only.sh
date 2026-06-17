#!/usr/bin/env bash
# Prefer keyboard navigation in Kodi (remapper sends arrow keys).
# Run on the Pi before launch-kodi.sh if native joystick conflicts.

set -euo pipefail

GUISETTINGS="${HOME}/.kodi/userdata/guisettings.xml"

if [[ ! -f "$GUISETTINGS" ]]; then
  echo "No guisettings.xml yet — start Kodi once, then re-run."
  exit 0
fi

python3 - "$GUISETTINGS" <<'PY'
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
tree = ET.parse(path)
root = tree.getroot()

def set_bool(setting_id: str, value: bool) -> None:
    for elem in root.iter("setting"):
        if elem.get("id") == setting_id:
            elem.text = "true" if value else "false"
            return
    # Create if missing (Kodi format)
    section = root.find(".//section[@id='input']")
    if section is None:
        return
    elem = ET.SubElement(section, "setting", id=setting_id)
    elem.text = "true" if value else "false"

set_bool("input.enablejoysticks", False)
tree.write(path, encoding="UTF-8", xml_declaration=True)
print("Kodi: input.enablejoysticks = false (keyboard/remapper only)")
PY
