#!/usr/bin/env python3
"""8BitDo Micro -> xdotool for mango TV (single pad owner).

Routes by foreground surface:
  Launcher — arrow keys + Return
  mpv      — arrow keys + space/back via IPC

Home (316/311) runs launch-launcher.sh or mpv-stop — never keyboard chords.
See docs/HARDWARE.md
"""

from __future__ import annotations

import json
import errno
import os
import pwd
import re
import select
import signal
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
CACHE_DIR = _HOME / ".cache" / "mango"
PID_PATH = CACHE_DIR / "mango-tv-pad.pid"
STATUS_PATH = CACHE_DIR / "mango-tv-pad-status.json"
LAUNCHER_SH = REPO / "scripts/launch-launcher.sh"
MPV_IPC_SH = REPO / "scripts/m2-catalog/service/mpv-ipc.sh"
MPV_STOP_SH = REPO / "scripts/m2-catalog/service/mpv-stop.sh"
DISPLAY_WAKE_SH = REPO / "scripts/lib/mango-display-wake.sh"
COUCH_ACTIVITY_SH = REPO / "scripts/lib/couch-activity.sh"
LAUNCHER_PORT = os.environ.get("MANGO_LAUNCHER_PORT", "3000")

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
BT_CONNECT_INTERVAL_SEC = 8.0
BT_CONNECT_TIMEOUT_SEC = 6.0
DISPLAY_WAKE_THROTTLE_SEC = 3.0
STATUS_HEARTBEAT_SEC = 2.0


class DeviceNotFoundError(Exception):
    pass

DIAG_SESSION = os.environ.get("MANGO_DIAG_SESSION", "")
PAD_DEBUG = os.environ.get("MANGO_PAD_DEBUG") == "1"
_env = {"DISPLAY": DISPLAY, "XAUTHORITY": XAUTHORITY, "HOME": str(_HOME)}
_last_display_wake_at = 0.0
_last_bt_connect_at = 0.0


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


def _tv_user_ids() -> tuple[int, int] | None:
    if _TV_USER in ("", "root"):
        return None
    try:
        entry = pwd.getpwnam(_TV_USER)
    except KeyError:
        return None
    return entry.pw_uid, entry.pw_gid


def _write_owner_file(path: Path, text: str, *, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.chmod(tmp, mode)
        ids = _tv_user_ids()
        if ids is not None and os.geteuid() == 0:
            os.chown(tmp, ids[0], ids[1])
        tmp.replace(path)
        os.chmod(path, mode)
        if ids is not None and os.geteuid() == 0:
            os.chown(path, ids[0], ids[1])
    except OSError:
        try:
            tmp.unlink()
        except OSError:
            pass


def write_pid_file() -> None:
    _write_owner_file(PID_PATH, f"{os.getpid()}\n")


def _device_payload(dev: evdev.InputDevice | None) -> dict[str, object]:
    if dev is None:
        return {}
    return {
        "device_path": dev.path,
        "device_name": dev.name,
        "device_uniq": getattr(dev, "uniq", "") or "",
        "device_phys": getattr(dev, "phys", "") or "",
    }


def write_status(
    state: str,
    dev: evdev.InputDevice | None = None,
    *,
    last_event_at: float = 0.0,
    last_action: str = "",
) -> None:
    now = time.time()
    payload: dict[str, object] = {
        "ok": state == "running",
        "state": state,
        "pid": os.getpid(),
        "updated_at": now,
        "last_event_at": last_event_at,
        "last_action": last_action,
    }
    payload.update(_device_payload(dev))
    _write_owner_file(STATUS_PATH, json.dumps(payload, separators=(",", ":")) + "\n")


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


def run_tv_user(argv: list[str], *, timeout: float = 2.0) -> None:
    try:
        subprocess.run(
            as_tv_user(argv),
            env=_env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def touch_couch_activity(hint: str) -> None:
    if COUCH_ACTIVITY_SH.is_file():
        run_tv_user(["bash", str(COUCH_ACTIVITY_SH), "touch", "pad", hint], timeout=1.0)


def wake_display_for_input(hint: str) -> None:
    global _last_display_wake_at
    touch_couch_activity(hint)
    now = time.monotonic()
    if now - _last_display_wake_at < DISPLAY_WAKE_THROTTLE_SEC:
        return
    _last_display_wake_at = now
    if DISPLAY_WAKE_SH.is_file():
        run_tv_user(["bash", str(DISPLAY_WAKE_SH), "--focus-launcher-if-idle"], timeout=2.0)


def _xdotool(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["xdotool", *args],
        env=_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )


def _window_class(wid: str) -> str:
    result = _xdotool("getwindowclassname", wid)
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip().lower()
    try:
        result = subprocess.run(
            ["xprop", "-id", wid, "WM_CLASS"],
            env=_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return ""
    matches = re.findall(r'"([^"]+)"', result.stdout)
    if matches:
        return " ".join(part.lower() for part in matches)
    return result.stdout.strip().lower()


def _window_name(wid: str) -> str:
    return _xdotool("getwindowname", wid).stdout.strip().lower()


def _window_process(wid: str) -> str:
    pid = _xdotool("getwindowpid", wid).stdout.strip()
    if not pid.isdigit():
        return ""
    try:
        result = subprocess.run(
            ["ps", "-p", pid, "-o", "comm="],
            env=_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return ""
    return result.stdout.strip().lower()


def _window_cmdline(wid: str) -> str:
    pid = _xdotool("getwindowpid", wid).stdout.strip()
    if not pid.isdigit():
        return ""
    try:
        result = subprocess.run(
            ["ps", "-p", pid, "-o", "args="],
            env=_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return ""
    return result.stdout.strip().lower()


def _window_xwininfo(wid: str) -> str:
    try:
        result = subprocess.run(
            ["xwininfo", "-id", wid],
            env=_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return ""
    return result.stdout


def active_window_meta() -> tuple[str, str]:
    wid = _xdotool("getactivewindow").stdout.strip()
    if not wid or wid == "0":
        return "", ""
    name = _window_name(wid)
    klass = _window_class(wid)
    return name, klass.lower()


def _launcher_browser_pids() -> list[str]:
    try:
        result = subprocess.run(
            [
                "pgrep",
                "-f",
                rf"chromium.*--class=mango-launcher.*127\.0\.0\.1:{LAUNCHER_PORT}/|firefox.*127\.0\.0\.1:{LAUNCHER_PORT}/",
            ],
            env=_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return []
    return [pid for pid in result.stdout.split() if pid.isdigit()]


def _launcher_window_ids() -> list[str]:
    ids: list[str] = []
    for pid in _launcher_browser_pids():
        result = _xdotool("search", "--pid", pid)
        if result.returncode == 0 and result.stdout.strip():
            ids.extend(result.stdout.split())
    if ids:
        return list(dict.fromkeys(ids))
    for args in (("--class", "mango-launcher"), ("--class", "firefox")):
        result = _xdotool("search", *args)
        if result.returncode == 0 and result.stdout.strip():
            ids.extend(result.stdout.split())
    return list(dict.fromkeys(ids))


def _is_launcher_window(wid: str) -> bool:
    name = _window_name(wid)
    klass = _window_class(wid)
    process = _window_process(wid)
    cmdline = _window_cmdline(wid)
    xwininfo = _window_xwininfo(wid)
    if "selection owner" in name or "tooltip" in name:
        return False
    if "/overlay/" in cmdline or "mango-overlay" in klass:
        return False
    if f"127.0.0.1:{LAUNCHER_PORT}/" not in cmdline:
        return False
    if "Map State: IsViewable" not in xwininfo:
        return False
    if "Class: InputOutput" not in xwininfo:
        return False
    if "mango-launcher" in klass and process in {"chromium", "chrome", "chromium-browser"}:
        return True
    browser_blob = f"{klass} {process} {cmdline}"
    return "firefox" in browser_blob or "navigator" in browser_blob


def is_launcher_focused() -> bool:
    wid = _xdotool("getactivewindow").stdout.strip()
    if not wid or wid == "0":
        return False
    return _is_launcher_window(wid)


def is_mpv_focused() -> bool:
    wid = _xdotool("getactivewindow").stdout.strip()
    if not wid or wid == "0":
        return False
    name = _xdotool("getwindowname", wid).stdout.strip().lower()
    if "mpv" in name:
        return True
    klass = _window_class(wid)
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
            if class_hint.lower() not in _window_class(wid):
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


def find_launcher_wid() -> str | None:
    best_wid: str | None = None
    best_area = 0
    for wid in _launcher_window_ids():
        if not _is_launcher_window(wid):
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


def send_key_launcher(symbol: str) -> None:
    wid = find_launcher_wid()
    if not wid:
        return
    send_key_to_wid(wid, symbol, activate=True)


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
        if not is_launcher_focused():
            wid = find_launcher_wid()
            if wid:
                _xdotool("windowactivate", wid)
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
    if app == "mpv":
        send_mpv_ipc("keypress", symbol.upper())
    elif app == "launcher":
        send_key_launcher(symbol)


def route_face(app: str, action: str) -> None:
    if action == "select":
        symbol = "Return"
        if app == "mpv":
            send_mpv_ipc("keypress", "SPACE")
        elif app == "launcher":
            send_key_launcher(symbol)
    elif action == "back":
        if app == "mpv":
            stop_mpv_home()
        elif app == "launcher":
            send_key_launcher("BackSpace")


def find_pro_controller() -> evdev.InputDevice:
    required_keys = {BTN_B, BTN_Y}
    stick_abs = {ecodes.ABS_X, ecodes.ABS_Y}
    hat_abs = {ecodes.ABS_HAT0X, ecodes.ABS_HAT0Y}
    for path in evdev.list_devices():
        dev = evdev.InputDevice(path)
        if dev.name != "Pro Controller":
            continue
        caps = dev.capabilities()
        keys = set(caps.get(ecodes.EV_KEY, []))
        abs_axes = {
            item[0] if isinstance(item, tuple) else item
            for item in caps.get(ecodes.EV_ABS, [])
        }
        if required_keys.issubset(keys) and (
            stick_abs.issubset(abs_axes) or hat_abs.issubset(abs_axes)
        ):
            return dev
    raise DeviceNotFoundError(
        "Pro Controller not found — press any button on the Micro to wake Bluetooth"
    )


def current_pro_controller_path() -> str | None:
    try:
        dev = find_pro_controller()
    except DeviceNotFoundError:
        return None
    try:
        return dev.path
    finally:
        release_device(dev)


def _run_bluetoothctl(args: list[str], *, timeout: float) -> subprocess.CompletedProcess[str] | None:
    try:
        proc = subprocess.Popen(
            ["bluetoothctl", *args],
            env=_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            start_new_session=True,
        )
    except OSError:
        return None
    try:
        stdout, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            proc.kill()
        stdout, _ = proc.communicate()
    return subprocess.CompletedProcess(["bluetoothctl", *args], proc.returncode, stdout, "")


def bluetooth_connected() -> bool:
    result = _run_bluetoothctl(["info", BT_MAC], timeout=2.0)
    return result is not None and "Connected: yes" in (result.stdout or "")


def try_bluetooth_connect() -> None:
    global _last_bt_connect_at
    now = time.monotonic()
    if now - _last_bt_connect_at < BT_CONNECT_INTERVAL_SEC:
        return
    _last_bt_connect_at = now
    if bluetooth_connected():
        return
    _run_bluetoothctl(["connect", BT_MAC], timeout=BT_CONNECT_TIMEOUT_SEC)


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
    last_event_at = 0.0
    write_status("running", dev, last_event_at=last_event_at, last_action="grabbed")

    def debounced(action: str, fn) -> None:
        now = time.monotonic()
        if now - last.get(action, 0) < DEBOUNCE_SEC:
            return
        last[action] = now
        wake_display_for_input(action)
        fn()

    def heartbeat() -> bool:
        current_path = current_pro_controller_path()
        if current_path and current_path != dev.path:
            print(
                f"mango-tv-pad: controller moved {dev.path} -> {current_path}, will reconnect",
                flush=True,
            )
            write_status(
                "reconnecting",
                dev,
                last_event_at=last_event_at,
                last_action=f"stale_device:{current_path}",
            )
            return False
        write_status("running", dev, last_event_at=last_event_at, last_action="heartbeat")
        return True

    try:
        while True:
            ready, _, _ = select.select([dev.fd], [], [], STATUS_HEARTBEAT_SEC)
            if not ready:
                if not heartbeat():
                    return
                continue
            for event in dev.read():
                last_event_at = time.time()
                write_status(
                    "running",
                    dev,
                    last_event_at=last_event_at,
                    last_action=f"event:{event.type}:{event.code}",
                )
                app = foreground_app()
                if event.type == ecodes.EV_ABS:
                    if event.code in (ecodes.ABS_X, ecodes.ABS_HAT0X):
                        threshold = 1 if event.code == ecodes.ABS_HAT0X else THRESH
                        if event.value <= -threshold:
                            debounced(f"{app}-left", lambda: route_dpad(app, "left"))
                        elif event.value >= threshold:
                            debounced(f"{app}-right", lambda: route_dpad(app, "right"))
                    elif event.code in (ecodes.ABS_Y, ecodes.ABS_HAT0Y):
                        threshold = 1 if event.code == ecodes.ABS_HAT0Y else THRESH
                        if event.value <= -threshold:
                            debounced(f"{app}-up", lambda: route_dpad(app, "up"))
                        elif event.value >= threshold:
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
        if exc.errno in (errno.ENODEV, errno.EIO):
            print("mango-tv-pad: device disconnected, will reconnect", flush=True)
            write_status(
                "reconnecting",
                dev,
                last_event_at=last_event_at,
                last_action=f"oserror:{exc.errno}",
            )
            return
        raise


def main() -> None:
    write_pid_file()
    write_status("starting", last_action="boot")
    print("mango-tv-pad: router ready (wake pad with any button)", flush=True)
    while True:
        dev: evdev.InputDevice | None = None
        try:
            dev = wait_for_device()
            print(f"mango-tv-pad: {dev.path} ({dev.name})", flush=True)
            run_pad_session(dev)
        except KeyboardInterrupt:
            release_device(dev)
            write_status("stopped", dev, last_action="keyboard_interrupt")
            break
        except DeviceNotFoundError as exc:
            print(f"mango-tv-pad: {exc}", flush=True)
            write_status("waiting", dev, last_action="device_not_found")
        except Exception as exc:  # noqa: BLE001 — keep router alive for TV
            print(f"mango-tv-pad: error: {exc}", flush=True)
            write_status("error", dev, last_action=type(exc).__name__)
        finally:
            release_device(dev)
        time.sleep(RECONNECT_SLEEP_SEC)


if __name__ == "__main__":
    main()
