#!/usr/bin/env python3
"""8BitDo Micro -> xdotool keys for Stremio (Qt ignores input-remapper uinput).

Face buttons (right cluster, clockwise from left): Y · X · A · B
  Y = in-app back (308)   B = select (304)   home = 316 or 311
See docs/HARDWARE.md

Keys are sent to the main Stremio window WID (not whatever has focus).
Stremio in-app back uses Escape — BackSpace navigates the embedded webview and
can land on a blank page with the mango overlay stuck on top.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

try:
    import evdev
    from evdev import ecodes
except ImportError:
    sys.exit("Install: sudo apt install -y python3-evdev")

DISPLAY = os.environ.get("DISPLAY", ":0")
XAUTHORITY = os.environ.get("XAUTHORITY", os.path.expanduser("~/.Xauthority"))
THRESH = int(32767 * 0.8)
DEBOUNCE_SEC = 0.12
LAUNCHER_SH = Path.home() / "mango/scripts/launch-launcher.sh"
PRESENT_STREMIO_SH = Path.home() / "mango/scripts/phase0/present-stremio.sh"

# Linux evdev BTN_* for 8BitDo Micro (Switch BT → "Pro Controller")
BTN_B = 304      # south — bottom — select
BTN_Y = 308      # west — left — in-app back
HOME_BUTTONS = {316, 311}  # MODE (primary) or TR (fallback) — right below −/+

_env = {"DISPLAY": DISPLAY, "XAUTHORITY": XAUTHORITY, "HOME": os.environ.get("HOME", "/home/aman")}


def find_pro_controller() -> evdev.InputDevice:
    for path in evdev.list_devices():
        dev = evdev.InputDevice(path)
        if dev.name == "Pro Controller":
            return dev
    raise SystemExit("Pro Controller not found — bluetoothctl connect E4:17:D8:EB:00:44")


def _xdotool(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["xdotool", *args],
        env=_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )


def find_stremio_wid() -> str | None:
    result = _xdotool("search", "--class", "Stremio")
    if result.returncode != 0 or not result.stdout.strip():
        return None

    best_wid: str | None = None
    best_area = 0
    for wid in result.stdout.split():
        name = _xdotool("getwindowname", wid).stdout.strip()
        low = name.lower()
        if "stremio" not in low or "selection owner" in low or "tooltip" in low:
            continue
        geom = _xdotool("getwindowgeometry", "--shell", wid).stdout
        width = height = 0
        for line in geom.splitlines():
            if line.startswith("WIDTH="):
                width = int(line.split("=", 1)[1])
            elif line.startswith("HEIGHT="):
                height = int(line.split("=", 1)[1])
        area = width * height
        if area > best_area:
            best_area = area
            best_wid = wid
    return best_wid


def stremio_open() -> bool:
    return find_stremio_wid() is not None


def focus_stremio(wid: str) -> None:
    _xdotool("windowactivate", wid)


def send_key_to_stremio(symbol: str) -> None:
    wid = find_stremio_wid()
    if not wid:
        return
    focus_stremio(wid)
    _xdotool("key", "--clearmodifiers", "--window", wid, symbol)


def go_home(device: evdev.InputDevice) -> None:
    try:
        device.ungrab()
    except OSError:
        pass
    subprocess.Popen(
        ["bash", str(LAUNCHER_SH)],
        env=_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    raise SystemExit(0)


def main() -> None:
    dev = find_pro_controller()
    print(f"stremio-pad-bridge: {dev.path} ({dev.name})", flush=True)
    dev.grab()

    last: dict[str, float] = {}

    def debounced(action: str, fn, *, always: bool = False) -> None:
        now = time.monotonic()
        if now - last.get(action, 0) < DEBOUNCE_SEC:
            return
        last[action] = now
        if always or stremio_open():
            fn()

    def select() -> None:
        send_key_to_stremio("Return")

    def back() -> None:
        send_key_to_stremio("Escape")
        subprocess.Popen(
            ["bash", str(PRESENT_STREMIO_SH)],
            env=_env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

    for event in dev.read_loop():
        if event.type == ecodes.EV_ABS:
            if event.code == ecodes.ABS_X:
                if event.value <= -THRESH:
                    debounced("left", lambda: send_key_to_stremio("Left"))
                elif event.value >= THRESH:
                    debounced("right", lambda: send_key_to_stremio("Right"))
            elif event.code == ecodes.ABS_Y:
                if event.value <= -THRESH:
                    debounced("up", lambda: send_key_to_stremio("Up"))
                elif event.value >= THRESH:
                    debounced("down", lambda: send_key_to_stremio("Down"))
        elif event.type == ecodes.EV_KEY and event.value == 1:
            if event.code == BTN_B:
                debounced("select", select)
            elif event.code == BTN_Y:
                debounced("back", back)
            elif event.code in HOME_BUTTONS:
                debounced("home", lambda: go_home(dev), always=True)


if __name__ == "__main__":
    main()
