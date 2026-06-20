#!/usr/bin/env python3
"""8BitDo Micro -> xdotool for mango TV (single pad owner).

One process grabs Pro Controller and routes by foreground app:
  Stremio  — Escape back, Return select (Qt ignores input-remapper)
  Kodi     — BackSpace back, Return select
  Launcher — arrow keys + Return

Home (316/311) always runs launch-launcher.sh directly — never keyboard chords.
See docs/HARDWARE.md
"""

from __future__ import annotations

import json
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
_TV_USER = os.environ.get("SUDO_USER") or os.environ.get("USER") or "aman"
_HOME = Path(f"/home/{_TV_USER}") if _TV_USER not in ("", "root") else Path.home()
XAUTHORITY = os.environ.get("XAUTHORITY", str(_HOME / ".Xauthority"))
THRESH = int(32767 * 0.8)
DEBOUNCE_SEC = 0.12
REPO = _HOME / "mango"
LAUNCHER_SH = REPO / "scripts/launch-launcher.sh"
PRESENT_STREMIO_SH = REPO / "scripts/phase0/present-stremio.sh"
MPV_IPC_SH = REPO / "scripts/phase-n1/mpv-ipc.sh"
MPV_STOP_SH = REPO / "scripts/phase-n1/mpv-stop.sh"

BTN_B = 304
BTN_Y = 308
BTN_MINUS = 314
BTN_TL = 310  # L shoulder — prev browse tab (launcher)
BTN_TR = 311  # R shoulder — next browse tab (launcher); home fallback elsewhere
BTN_SHUFFLE = 317  # BTN_THUMBL — bottom-left grid, left of ⌂ (Switch capture)
HOME_BUTTONS = {316, 311}
BT_MAC = "E4:17:D8:EB:00:44"
RECONNECT_SLEEP_SEC = 0.75
DEVICE_WAIT_SEC = 45.0


class DeviceNotFoundError(Exception):
    pass

DIAG_SESSION = os.environ.get("MANGO_DIAG_SESSION", "")
PAD_DEBUG = os.environ.get("MANGO_PAD_DEBUG") == "1"
_env = {"DISPLAY": DISPLAY, "XAUTHORITY": XAUTHORITY, "HOME": str(_HOME)}


def diag_event(kind: str, **fields: str) -> None:
    if not DIAG_SESSION and not PAD_DEBUG:
        return
    row = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "event": kind,
        **fields,
    }
    line = json.dumps(row, separators=(",", ":"))
    print(f"mango-tv-pad-diag: {line}", flush=True)
    if DIAG_SESSION:
        path = Path(DIAG_SESSION) / "pad-events.jsonl"
        try:
            with path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass


def as_tv_user(argv: list[str]) -> list[str]:
    if os.geteuid() == 0 and _TV_USER not in ("", "root"):
        return ["sudo", "-u", _TV_USER, "-E", *argv]
    return argv


def popen_tv_user(argv: list[str], *, extra_env: dict[str, str] | None = None) -> None:
    env = {**_env, **(extra_env or {})}
    subprocess.Popen(
        as_tv_user(argv),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def _xdotool(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["xdotool", *args],
        env=_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )


def active_window_meta() -> tuple[str, str]:
    wid = _xdotool("getactivewindow").stdout.strip()
    if not wid or wid == "0":
        return "", ""
    name = _xdotool("getwindowname", wid).stdout.strip()
    klass = _xdotool("getwindowclassname", wid).stdout.strip()
    return name.lower(), klass.lower()


def _launcher_window_ids() -> list[str]:
    result = _xdotool("search", "--class", "mango-launcher")
    if result.returncode != 0 or not result.stdout.strip():
        return []
    return result.stdout.split()


def is_launcher_focused() -> bool:
    """Chromium kiosk reports title 'mango' but xdotool class is often empty."""
    wid = _xdotool("getactivewindow").stdout.strip()
    if not wid or wid == "0":
        return False
    name = _xdotool("getwindowname", wid).stdout.strip().lower()
    if name in ("mango", "mango launcher"):
        return True
    return wid in _launcher_window_ids()


def is_mpv_focused() -> bool:
    wid = _xdotool("getactivewindow").stdout.strip()
    if not wid or wid == "0":
        return False
    name = _xdotool("getwindowname", wid).stdout.strip().lower()
    if "mpv" in name:
        return True
    klass = _xdotool("getwindowclassname", wid).stdout.strip().lower()
    if "mpv" in klass:
        return True
    return wid in _mpv_window_ids()


def _mpv_window_ids() -> list[str]:
    result = _xdotool("search", "--class", "mpv")
    if result.returncode != 0 or not result.stdout.strip():
        return []
    return result.stdout.split()


def foreground_app() -> str:
    name, klass = active_window_meta()
    blob = f"{name} {klass}"
    if is_mpv_focused() or "mpv" in blob:
        return "mpv"
    if "stremio" in blob and "selection owner" not in blob:
        return "stremio"
    if "kodi" in blob:
        return "kodi"
    if "mango-overlay" in klass or "mango overlay" in name:
        return "launcher"
    if "mango-launcher" in blob or "mango launcher" in name:
        return "launcher"
    if is_launcher_focused():
        return "launcher"
    return "other"


def find_best_wid(class_hint: str, name_hint: str) -> str | None:
    result = _xdotool("search", "--class", class_hint)
    if result.returncode != 0 or not result.stdout.strip():
        return None
    best_wid: str | None = None
    best_area = 0
    for wid in result.stdout.split():
        name = _xdotool("getwindowname", wid).stdout.strip()
        if name_hint.lower() not in name.lower():
            if class_hint.lower() not in (_xdotool("getwindowclassname", wid).stdout.strip().lower()):
                continue
        if "selection owner" in name.lower() or "tooltip" in name.lower():
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


def send_key_to_wid(wid: str, symbol: str, *, activate: bool = True) -> None:
    if activate:
        active = _xdotool("getactivewindow").stdout.strip()
        if active != wid:
            _xdotool("windowactivate", wid)
    _xdotool("key", "--clearmodifiers", "--window", wid, symbol)


def send_key_stremio(symbol: str) -> None:
    wid = find_best_wid("Stremio", "Stremio")
    if wid:
        # Escape to webview: avoid windowactivate — it steals focus and needs a second press.
        send_key_to_wid(wid, symbol, activate=symbol != "Escape")


def send_key_kodi(symbol: str) -> None:
    wid = find_best_wid("Kodi", "Kodi")
    if wid:
        send_key_to_wid(wid, symbol)


def send_key_launcher(symbol: str) -> None:
    wid = find_best_wid("mango-launcher", "mango")
    if not wid:
        return
    # Route keys without raising Chromium — overlay HUD must stay visible but not eat input.
    send_key_to_wid(wid, symbol, activate=False)


def send_mpv_ipc(command: str, arg: str = "") -> None:
    argv = ["bash", str(MPV_IPC_SH), command]
    if arg:
        argv.append(arg)
    popen_tv_user(argv)


def stop_mpv_home() -> None:
    popen_tv_user(
        ["bash", str(MPV_STOP_SH)],
        extra_env={"MANGO_MPV_STOP_HOME": "1", "MANGO_SKIP_REMAPPER": "1"},
    )


def launcher_surface_active() -> bool:
    if foreground_app() == "launcher":
        return True
    return bool(_launcher_window_ids())


def send_launcher_key(symbol: str) -> None:
    wid = find_best_wid("mango-launcher", "mango")
    if wid:
        _xdotool("windowactivate", "--sync", wid)
    send_key_launcher(symbol)


def switch_launcher_tab(delta: int) -> None:
    if not launcher_surface_active():
        return
    diag_event("tab_switch", foreground=foreground_app(), delta=str(delta))
    send_launcher_key("F7" if delta > 0 else "F6")


def reshuffle_launcher_rails() -> None:
    subprocess.run(
        [
            "curl",
            "-sf",
            "-X",
            "POST",
            "http://127.0.0.1:3020/playability/session/reshuffle",
            "-H",
            "content-type: application/json",
            "-d",
            "{}",
        ],
        env=_env,
        timeout=5,
        check=False,
    )
    send_launcher_key("F5")


def refresh_launcher_library() -> None:
    if not launcher_surface_active():
        return
    diag_event("shuffle_press", foreground=foreground_app())
    reshuffle_launcher_rails()


def go_home() -> None:
    name, klass = active_window_meta()
    app = foreground_app()
    if app == "launcher":
        diag_event(
            "home_press",
            foreground=app,
            active_name=name,
            active_class=klass,
            action="focus_launcher",
        )
        wid = find_best_wid("mango-launcher", "mango")
        if wid:
            _xdotool("windowactivate", "--sync", wid)
        return
    diag_event("home_press", foreground=app, active_name=name, active_class=klass)
    if app == "mpv":
        print("mango-tv-pad: home -> mpv-stop.sh + launcher", flush=True)
        stop_mpv_home()
        return
    print("mango-tv-pad: home -> launch-launcher.sh", flush=True)
    popen_tv_user(
        ["bash", str(LAUNCHER_SH)],
        extra_env={"MANGO_SKIP_PAD_STOP": "1", "MANGO_SKIP_REMAPPER": "1"},
    )


def route_dpad(app: str, direction: str) -> None:
    symbol = {"left": "Left", "right": "Right", "up": "Up", "down": "Down"}[direction]
    if app == "stremio":
        send_key_stremio(symbol)
    elif app == "kodi":
        send_key_kodi(symbol)
    elif app == "mpv":
        send_mpv_ipc("keypress", symbol.upper())
    elif app == "launcher":
        send_key_launcher(symbol)


def route_face(app: str, action: str) -> None:
    if action == "select":
        symbol = "Return"
        if app == "stremio":
            send_key_stremio(symbol)
        elif app == "kodi":
            send_key_kodi(symbol)
        elif app == "mpv":
            send_mpv_ipc("keypress", "SPACE")
        elif app == "launcher":
            send_key_launcher(symbol)
    elif action == "back":
        if app == "stremio":
            send_key_stremio("Escape")
            popen_tv_user(["bash", str(PRESENT_STREMIO_SH), "--after-back"])
        elif app == "kodi":
            send_key_kodi("BackSpace")
        elif app == "mpv":
            stop_mpv_home()
        elif app == "launcher":
            send_key_launcher("BackSpace")


def find_pro_controller() -> evdev.InputDevice:
    for path in evdev.list_devices():
        dev = evdev.InputDevice(path)
        if dev.name == "Pro Controller":
            return dev
    raise DeviceNotFoundError(
        "Pro Controller not found — press any button on the Micro to wake Bluetooth"
    )


def try_bluetooth_connect() -> None:
    subprocess.run(
        ["bluetoothctl", "connect", BT_MAC],
        env=_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
        timeout=8,
    )


def wait_for_device() -> evdev.InputDevice:
    deadline = time.monotonic() + DEVICE_WAIT_SEC
    while time.monotonic() < deadline:
        try:
            return find_pro_controller()
        except DeviceNotFoundError:
            try_bluetooth_connect()
            time.sleep(RECONNECT_SLEEP_SEC)
    raise DeviceNotFoundError("timed out waiting for Pro Controller")


def release_device(dev: evdev.InputDevice | None) -> None:
    if dev is None:
        return
    try:
        dev.ungrab()
    except OSError:
        pass
    try:
        dev.close()
    except OSError:
        pass


def run_pad_session(dev: evdev.InputDevice) -> None:
    dev.grab()
    last: dict[str, float] = {}

    def debounced(action: str, fn) -> None:
        now = time.monotonic()
        if now - last.get(action, 0) < DEBOUNCE_SEC:
            return
        last[action] = now
        fn()

    try:
        for event in dev.read_loop():
            app = foreground_app()
            if event.type == ecodes.EV_ABS:
                if event.code == ecodes.ABS_X:
                    if event.value <= -THRESH:
                        debounced(f"{app}-left", lambda: route_dpad(app, "left"))
                    elif event.value >= THRESH:
                        debounced(f"{app}-right", lambda: route_dpad(app, "right"))
                elif event.code == ecodes.ABS_Y:
                    if event.value <= -THRESH:
                        debounced(f"{app}-up", lambda: route_dpad(app, "up"))
                    elif event.value >= THRESH:
                        debounced(f"{app}-down", lambda: route_dpad(app, "down"))
            elif event.type == ecodes.EV_KEY and event.value == 1:
                diag_event(
                    "ev_key",
                    code=str(event.code),
                    foreground=app,
                )
                if event.code == BTN_B:
                    debounced(f"{app}-select", lambda: route_face(app, "select"))
                elif event.code == BTN_Y:
                    debounced(f"{app}-back", lambda: route_face(app, "back"))
                elif event.code == BTN_SHUFFLE:
                    debounced("shuffle", refresh_launcher_library)
                elif app == "launcher" and event.code == BTN_TL:
                    debounced("tab-prev", lambda: switch_launcher_tab(-1))
                elif app == "launcher" and event.code == BTN_TR:
                    debounced("tab-next", lambda: switch_launcher_tab(1))
                elif event.code in HOME_BUTTONS:
                    debounced("home", go_home)
    except OSError as exc:
        if exc.errno == 19:  # ENODEV — Bluetooth dropped
            print("mango-tv-pad: device disconnected, will reconnect", flush=True)
            return
        raise


def main() -> None:
    print("mango-tv-pad: router ready (wake pad with any button)", flush=True)
    while True:
        dev: evdev.InputDevice | None = None
        try:
            dev = wait_for_device()
            print(f"mango-tv-pad: {dev.path} ({dev.name})", flush=True)
            run_pad_session(dev)
        except KeyboardInterrupt:
            release_device(dev)
            break
        except DeviceNotFoundError as exc:
            print(f"mango-tv-pad: {exc}", flush=True)
        except Exception as exc:  # noqa: BLE001 — keep router alive for TV
            print(f"mango-tv-pad: error: {exc}", flush=True)
        finally:
            release_device(dev)
        time.sleep(RECONNECT_SLEEP_SEC)


if __name__ == "__main__":
    main()
