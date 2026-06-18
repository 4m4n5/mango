#!/usr/bin/env bash
# Install Openbox rules for TV-sized Stremio/Kodi + Home key (− / Control+Alt+m).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib/openbox-rc.sh
source "$SCRIPT_DIR/../lib/openbox-rc.sh"

MARKER_BEGIN="<!-- mango media tv v3 begin -->"
MARKER_END="<!-- mango media tv v3 end -->"
HOME_MARKER="<!-- mango home key v3 begin -->"

SNIPPET="$MARKER_BEGIN
  <application class=\"mango-launcher\">
    <decor>no</decor>
    <maximized>true</maximized>
    <fullscreen>yes</fullscreen>
    <focus>yes</focus>
  </application>
  <application class=\"Stremio\">
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
    <keybind key=\"C-A-m\">
      <action name=\"Execute\">
        <command>bash ~/mango/scripts/launch-launcher.sh</command>
      </action>
    </keybind>
    <!-- mango home key v3 end -->"

RC_FILE=$(ensure_mango_openbox_rc)
echo "Using Openbox config: $RC_FILE"

cp "$RC_FILE" "${RC_FILE}.bak.$(date +%Y%m%d%H%M%S)"

python3 - "$RC_FILE" "$SNIPPET" "$MARKER_BEGIN" "$MARKER_END" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
snippet = sys.argv[2]
begin = sys.argv[3]
end = sys.argv[4]
text = path.read_text()

for old_begin in (
    "<!-- mango media tv v3 begin -->",
    "<!-- mango media tv v2 begin -->",
    "<!-- mango media tv begin -->",
    "<!-- mango stremio tv begin -->",
):
    old_end = old_begin.replace(" begin -->", " end -->")
    text = re.sub(re.escape(old_begin) + r".*?" + re.escape(old_end), "", text, flags=re.S)

if begin not in text:
    if "</applications>" in text:
        text = text.replace("</applications>", snippet + "\n  </applications>", 1)
    else:
        raise SystemExit("No </applications> in rc.xml")

path.write_text(text)
PY

python3 - "$RC_FILE" "$HOME_SNIPPET" "$HOME_MARKER" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
snippet = sys.argv[2]
marker = sys.argv[3]
text = path.read_text()

for old in (
    "<!-- mango home key v3 begin -->",
    "<!-- mango home key v2 begin -->",
    "<!-- mango home key begin -->",
):
    old_end = old.replace(" begin -->", " end -->")
    text = re.sub(re.escape(old) + r".*?" + re.escape(old_end), "", text, flags=re.S)

if marker not in text:
    if "</keyboard>" not in text:
        raise SystemExit("No </keyboard> in rc.xml")
    text = text.replace("</keyboard>", snippet + "\n  </keyboard>", 1)

# Drop legacy home binds — Kodi captures F12/Super+h; C-A-m is the TV home chord.
text = re.sub(
    r"\s*<keybind key=\"F12\">\s*<action name=\"Execute\">\s*"
    r"<command>bash ~/mango/scripts/launch-launcher\.sh</command>\s*</action>\s*</keybind>",
    "",
    text,
    flags=re.S,
)
text = re.sub(
    r"\s*<keybind key=\"W-h\">\s*<action name=\"Execute\">\s*"
    r"<command>bash ~/mango/scripts/launch-launcher\.sh</command>\s*</action>\s*</keybind>",
    "",
    text,
    flags=re.S,
)

path.write_text(text)
PY

python3 - "$RC_FILE" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()

# Global Escape → launcher breaks Stremio Y (pad bridge sends Escape for in-app back).
text = re.sub(
    r"\s*<!-- mango phase1 begin -->.*?<!-- mango phase1 end -->",
    "",
    text,
    flags=re.S,
)

path.write_text(text)
PY

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
openbox --reconfigure 2>/dev/null || echo "! openbox --reconfigure skipped (set DISPLAY=:0)"

echo "Installed Stremio/Kodi TV rules + Control+Alt+m home keybind."
