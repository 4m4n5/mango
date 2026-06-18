#!/usr/bin/env bash
# Install Phase 1 Openbox autostart and Escape-to-launcher keybind.

set -euo pipefail

OPENBOX_DIR="${HOME}/.config/openbox"
AUTOSTART_FILE="$OPENBOX_DIR/autostart"
RC_FILE="$OPENBOX_DIR/rc.xml"
START_LINE='bash ~/mango/scripts/phase1/start-mango-ui.sh &'
MARKER_BEGIN="# mango phase1 begin"
MARKER_END="# mango phase1 end"

mkdir -p "$OPENBOX_DIR"

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

if [[ -f "$RC_FILE" ]] && ! grep -Fq "mango/scripts/launch-launcher.sh" "$RC_FILE"; then
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
elif [[ ! -f "$RC_FILE" ]]; then
  cat >"$OPENBOX_DIR/mango-rc-keybind.xml" <<'EOF'
<!-- Add inside <keyboard> in ~/.config/openbox/rc.xml -->
<keybind key="Escape">
  <action name="Execute">
    <command>bash ~/mango/scripts/launch-launcher.sh</command>
  </action>
</keybind>
EOF
  echo "No rc.xml found; wrote manual snippet to $OPENBOX_DIR/mango-rc-keybind.xml"
fi

echo "Openbox autostart installed. Restart Openbox or reboot the Pi."
