#!/usr/bin/env bash
# Install Openbox rules for TV-sized Stremio/Kodi + Home key (8BitDo + button).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib/openbox-rc.sh
source "$SCRIPT_DIR/../lib/openbox-rc.sh"

MARKER_BEGIN="<!-- mango media tv begin -->"
MARKER_END="<!-- mango media tv end -->"
HOME_MARKER="<!-- mango home key begin -->"

SNIPPET="$MARKER_BEGIN
  <application name=\"*Stremio*\">
    <decor>no</decor>
    <maximized>true</maximized>
    <fullscreen>yes</fullscreen>
    <focus>yes</focus>
  </application>
  <application name=\"Kodi\">
    <decor>no</decor>
    <maximized>true</maximized>
    <fullscreen>yes</fullscreen>
    <focus>yes</focus>
  </application>
$MARKER_END"

HOME_SNIPPET="$HOME_MARKER
    <keybind key=\"XF86Home\">
      <action name=\"Execute\">
        <command>bash ~/mango/scripts/launch-launcher.sh</command>
      </action>
    </keybind>
    <!-- mango home key end -->"

RC_FILE=$(ensure_mango_openbox_rc)
echo "Using Openbox config: $RC_FILE"

if ! grep -Fq "$MARKER_BEGIN" "$RC_FILE"; then
  cp "$RC_FILE" "${RC_FILE}.bak.$(date +%Y%m%d%H%M%S)"
  python3 - "$RC_FILE" "$SNIPPET" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
snippet = sys.argv[2]
text = path.read_text()
if "</applications>" in text:
    text = text.replace("</applications>", snippet + "\n  </applications>", 1)
else:
    raise SystemExit("No </applications> in rc.xml")
path.write_text(text)
PY
  echo "Installed Stremio/Kodi TV window rules."
else
  echo "Media TV window rules already installed."
fi

if ! grep -Fq "$HOME_MARKER" "$RC_FILE"; then
  cp "$RC_FILE" "${RC_FILE}.bak.$(date +%Y%m%d%H%M%S)"
  python3 - "$RC_FILE" "$HOME_SNIPPET" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
snippet = sys.argv[2]
text = path.read_text()
if "</keyboard>" not in text:
    raise SystemExit("No </keyboard> in rc.xml")
text = text.replace("</keyboard>", snippet + "\n  </keyboard>", 1)
path.write_text(text)
PY
  echo "Installed XF86Home → launcher keybind."
else
  echo "Home keybind already installed."
fi

echo "Run: openbox --reconfigure   (or reboot)"
