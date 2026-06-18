#!/usr/bin/env bash
# Install Phase 1 Openbox autostart and Escape-to-launcher keybind.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib/openbox-rc.sh
source "$SCRIPT_DIR/../lib/openbox-rc.sh"

OPENBOX_DIR="${HOME}/.config/openbox"
AUTOSTART_FILE="$OPENBOX_DIR/autostart"
START_LINE='bash ~/mango/scripts/phase1/start-mango-ui.sh &'
MARKER_BEGIN="# mango phase1 begin"
MARKER_END="# mango phase1 end"
KEYBIND_MARKER="<!-- mango phase1 begin -->"

mkdir -p "$OPENBOX_DIR"

RC_FILE=$(ensure_mango_openbox_rc)
echo "Using Openbox config: $RC_FILE"

if [[ -f "$AUTOSTART_FILE" ]]; then
  cp "$AUTOSTART_FILE" "${AUTOSTART_FILE}.bak.$(date +%Y%m%d%H%M%S)"
fi

if [[ ! -f "$AUTOSTART_FILE" ]]; then
  touch "$AUTOSTART_FILE"
fi

if ! grep -Fq "$MARKER_BEGIN" "$AUTOSTART_FILE"; then
  {
    echo
    echo "$MARKER_BEGIN"
    echo "$START_LINE"
    echo "$MARKER_END"
  } >>"$AUTOSTART_FILE"
fi

if ! grep -Fq "$KEYBIND_MARKER" "$RC_FILE"; then
  cp "$RC_FILE" "${RC_FILE}.bak.$(date +%Y%m%d%H%M%S)"
  python3 - "$RC_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
snippet = """    <!-- mango phase1 begin -->
    <keybind key="Escape">
      <action name="Execute">
        <command>bash ~/mango/scripts/launch-launcher.sh</command>
      </action>
    </keybind>
    <!-- mango phase1 end -->
"""
if "</keyboard>" not in text:
    raise SystemExit("No </keyboard> tag found in rc.xml")
path.write_text(text.replace("</keyboard>", snippet + "  </keyboard>", 1))
PY
else
  echo "Escape-to-launcher keybind already installed."
fi

echo "Openbox autostart installed. Restart Openbox or reboot the Pi."
