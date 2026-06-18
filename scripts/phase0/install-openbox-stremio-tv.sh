#!/usr/bin/env bash
# Install Openbox rules so Stremio opens borderless and maximized on the TV.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib/openbox-rc.sh
source "$SCRIPT_DIR/../lib/openbox-rc.sh"

MARKER_BEGIN="<!-- mango stremio tv begin -->"
MARKER_END="<!-- mango stremio tv end -->"

SNIPPET="$MARKER_BEGIN
  <application name=\"Stremio\" class=\"stremio\">
    <decor>no</decor>
    <maximized>true</maximized>
    <fullscreen>yes</fullscreen>
    <focus>yes</focus>
  </application>
$MARKER_END"

RC_FILE=$(ensure_mango_openbox_rc)
echo "Using Openbox config: $RC_FILE"

if grep -Fq "$MARKER_BEGIN" "$RC_FILE"; then
  echo "Stremio TV Openbox rules already installed."
  exit 0
fi

cp "$RC_FILE" "${RC_FILE}.bak.$(date +%Y%m%d%H%M%S)"

python3 - "$RC_FILE" "$SNIPPET" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
snippet = sys.argv[2]
text = path.read_text()
if "</applications>" in text:
    text = text.replace("</applications>", snippet + "\n  </applications>", 1)
elif "</openbox_config>" in text:
    text = text.replace(
        "</openbox_config>",
        "  <applications>\n" + snippet + "\n  </applications>\n</openbox_config>",
        1,
    )
else:
    raise SystemExit("Could not find </applications> or </openbox_config> in rc.xml")
path.write_text(text)
PY

echo "Installed Stremio TV window rules in $RC_FILE"
echo "Run: openbox --reconfigure   (or reboot)"
