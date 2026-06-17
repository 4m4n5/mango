#!/usr/bin/env python3
"""8BitDo Micro -> xdotool keys for Stremio (Qt ignores input-remapper uinput)."""

from __future__ import annotations

import os
import subprocess
import sys
import time

try:
    import evdev
    from evdev import ecodes
except ImportError:
    sys.exit("Install: sudo apt install -y python3-evdev")

DISPLAY = os.environ.get("DISPLAY", ":0")
XAUTHORITY = os.environ.get("XAUTHORITY", os.path.expanduser("~/.Xauthority"))
THRESH = int(32767 * 0.8)
DEBOUNCE_SEC = 0.12

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
        return "stremio" in name.lower()
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


def main() -> None:
    dev = find_pro_controller()
    print(f"stremio-pad-bridge: {dev.path} ({dev.name})", flush=True)
    dev.grab()

    last: dict[str, float] = {}

    def debounced(action: str, symbol: str) -> None:
        now = time.monotonic()
        if now - last.get(action, 0) < DEBOUNCE_SEC:
            return
        last[action] = now
        if stremio_active():
            send_key(symbol)

    btn_map = {
        305: "Return",      # B
        308: "BackSpace",   # Y
    }

    for event in dev.read_loop():
        if event.type == ecodes.EV_ABS:
            if event.code == ecodes.ABS_X:
                if event.value <= -THRESH:
                    debounced("left", "Left")
                elif event.value >= THRESH:
                    debounced("right", "Right")
            elif event.code == ecodes.ABS_Y:
                if event.value <= -THRESH:
                    debounced("up", "Up")
                elif event.value >= THRESH:
                    debounced("down", "Down")
        elif event.type == ecodes.EV_KEY and event.value == 1:
            sym = btn_map.get(event.code)
            if sym:
                debounced(f"btn{event.code}", sym)


if __name__ == "__main__":
    main()
