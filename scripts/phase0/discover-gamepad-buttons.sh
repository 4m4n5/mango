#!/usr/bin/env bash
# Log which evdev codes fire when you press each pad button (15 seconds).

set -euo pipefail

DURATION="${1:-15}"

python3 - "$DURATION" <<'PY'
import sys
import time
import evdev
from evdev import ecodes

duration = int(sys.argv[1])
dev = None
for path in evdev.list_devices():
    d = evdev.InputDevice(path)
    if d.name == "Pro Controller":
        dev = d
        break

if dev is None:
    raise SystemExit("Pro Controller not found — bluetoothctl connect E4:17:D8:EB:00:44")

print(f"Listening on {dev.path} ({dev.name}) for {duration}s — press each button once.")
print("Codes: 304=B 308=Y 314=− 315=+ 316=HOME/MODE 311=TR")
seen = set()
end = time.monotonic() + duration
try:
    dev.grab()
except OSError:
    print("(could not grab — events may be partial while remapper is active)")
while time.monotonic() < end:
    for event in dev.read():
        if event.type != ecodes.EV_KEY or event.value != 1:
            continue
        name = ecodes.BTN.get(event.code) or ecodes.KEY.get(event.code) or event.code
        key = (event.code, str(name))
        if key in seen:
            continue
        seen.add(key)
        print(f"  code {event.code}: {name}")
PY
