#!/usr/bin/env python3
"""8BitDo Micro -> xdotool keys for Stremio (Qt ignores input-remapper uinput).

Face buttons (right cluster, clockwise from left): Y · X · A · B
  Y = in-app back (308)   B = select (304)   + center-right = home (315)
See docs/HARDWARE.md
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

# Linux evdev BTN_* for 8BitDo Micro (Switch BT → "Pro Controller")
BTN_B = 304      # south — bottom — select
BTN_Y = 308      # west — left — in-app back
BTN_HOME = 315   # start — center-right + — mango launcher

_env = {"DISPLAY": DISPLAY, "XAUTHORITY": XAUTHORITY, "HOME": os.environ.get("HOME", "/home/aman")}


def find_pro_controller() -> evdev.InputDevice:
    for path in evdev.list_devices():
        dev = evdev.InputDevice(path)
        if dev.name == "Pro Controller":
            return dev
    raise SystemExit("Pro Controller not found — bluetoothctl connect E4:17:D8:EB:00:44")


def stremio_active() -> bool:
    try:
        name = subprocess.check_output(
            ["xdotool", "getactivewindow", "getwindowname"],
            env=_env,
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        low = name.lower()
        if "selection owner" in low or "tooltip" in low:
            return False
        return "stremio" in low
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def send_key(symbol: str) -> None:
    subprocess.run(
        ["xdotool", "key", "--clearmodifiers", symbol],
        env=_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def go_home() -> None:
    if LAUNCHER_SH.is_file():
        subprocess.run(["bash", str(LAUNCHER_SH)], env=_env, check=False)
    else:
        send_key("XF86Home")


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
        if always or stremio_active():
            fn()

    def select() -> None:
        send_key("Return")

    def back() -> None:
        send_key("BackSpace")

    for event in dev.read_loop():
        if event.type == ecodes.EV_ABS:
            if event.code == ecodes.ABS_X:
                if event.value <= -THRESH:
                    debounced("left", lambda: send_key("Left"))
                elif event.value >= THRESH:
                    debounced("right", lambda: send_key("Right"))
            elif event.code == ecodes.ABS_Y:
                if event.value <= -THRESH:
                    debounced("up", lambda: send_key("Up"))
                elif event.value >= THRESH:
                    debounced("down", lambda: send_key("Down"))
        elif event.type == ecodes.EV_KEY and event.value == 1:
            if event.code == BTN_B:
                debounced("select", select)
            elif event.code == BTN_Y:
                debounced("back", back)
            elif event.code == BTN_HOME:
                debounced("home", go_home, always=True)


if __name__ == "__main__":
    main()
