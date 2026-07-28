#!/usr/bin/env python3
"""8BitDo Micro -> xdotool for mango TV (single pad owner).

Routes by foreground surface:
  Launcher — arrow keys + Return
  playback — mpv IPC (including during GPU-defer while launcher is still focused)

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
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from pad_context import contextual_secondary_surface, secondary_press_kind
from pad_mpv_ipc import MpvIpcError, send_mpv_command

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
DPAD_DEBOUNCE_SEC = float(os.environ.get("MANGO_PAD_DPAD_DEBOUNCE_SEC", "0.05"))
LAUNCHER_WID_TTL_SEC = float(os.environ.get("MANGO_PAD_LAUNCHER_WID_TTL_SEC", "2.0"))
VOLUME_STEP_PERCENT = 5
WAIT_LOG_INTERVAL_SEC = float(os.environ.get("MANGO_PAD_WAIT_LOG_INTERVAL_SEC", "45.0"))
REPO = _HOME / "mango"
CACHE_DIR = _HOME / ".cache" / "mango"
PID_PATH = CACHE_DIR / "mango-tv-pad.pid"
STATUS_PATH = CACHE_DIR / "mango-tv-pad-status.json"
LAUNCHER_SH = REPO / "scripts/launch-launcher.sh"
MPV_IPC_SH = REPO / "scripts/m2-catalog/service/mpv-ipc.sh"
MPV_STOP_SH = REPO / "scripts/m2-catalog/service/mpv-stop.sh"
PLAYBACK_OSD_PY = REPO / "scripts/m2-catalog/service/playback-osd.py"
DISPLAY_MODE_SH = REPO / "scripts/lib/mango-display-mode.sh"
DISPLAY_WAKE_SH = REPO / "scripts/lib/mango-display-wake.sh"
COUCH_ACTIVITY_SH = REPO / "scripts/lib/couch-activity.sh"
LAUNCHER_PORT = os.environ.get("MANGO_LAUNCHER_PORT", "3000")
PLAYBACK_ACTIVE_FILE = Path(
    os.environ.get("MANGO_PLAYBACK_ACTIVE_FILE", str(CACHE_DIR / "playback-active"))
)
MPV_SOCKET_PATH = Path(os.environ.get("MANGO_MPV_SOCKET", str(CACHE_DIR / "mpv.sock")))
MPV_IPC_TIMEOUT_SEC = float(os.environ.get("MANGO_PAD_MPV_IPC_TIMEOUT_SEC", "0.2"))
PLAYBACK_SEEK_STEP_SEC = int(
    os.environ.get("MANGO_PLAYBACK_SEEK_STEP_SEC", os.environ.get("MANGO_VLC_SEEK_STEP_SEC", "10"))
)
PLAYBACK_SEEK_FAST_STEP_SEC = int(
    os.environ.get(
        "MANGO_PLAYBACK_SEEK_FAST_STEP_SEC",
        os.environ.get("MANGO_VLC_SEEK_FAST_STEP_SEC", "30"),
    )
)
PLAYBACK_SEEK_BIG_STEP_SEC = int(
    os.environ.get(
        "MANGO_PLAYBACK_SEEK_BIG_STEP_SEC",
        os.environ.get("MANGO_VLC_SEEK_BIG_STEP_SEC", "120"),
    )
)
PLAYBACK_SHOULDER_SEEK_STEP_SEC = int(
    os.environ.get(
        "MANGO_PLAYBACK_SHOULDER_SEEK_STEP_SEC",
        os.environ.get("MANGO_VLC_SHOULDER_SEEK_STEP_SEC", str(PLAYBACK_SEEK_BIG_STEP_SEC)),
    )
)
PLAYBACK_HOLD_SEEK_DELAY_SEC = float(
    os.environ.get("MANGO_PLAYBACK_HOLD_SEEK_DELAY_SEC", os.environ.get("MANGO_VLC_HOLD_SEEK_DELAY_SEC", "0.45"))
)
PLAYBACK_HOLD_SEEK_REPEAT_SEC = float(
    os.environ.get("MANGO_PLAYBACK_HOLD_SEEK_REPEAT_SEC", os.environ.get("MANGO_VLC_HOLD_SEEK_REPEAT_SEC", "0.55"))
)
PLAYBACK_HOLD_SEEK_FAST_AFTER_SEC = float(
    os.environ.get(
        "MANGO_PLAYBACK_HOLD_SEEK_FAST_AFTER_SEC",
        os.environ.get("MANGO_VLC_HOLD_SEEK_FAST_AFTER_SEC", "1.5"),
    )
)
PLAYBACK_HOLD_SEEK_BIG_AFTER_SEC = float(
    os.environ.get(
        "MANGO_PLAYBACK_HOLD_SEEK_BIG_AFTER_SEC",
        os.environ.get("MANGO_VLC_HOLD_SEEK_BIG_AFTER_SEC", "3.5"),
    )
)
PLAYBACK_APPS = frozenset({"mpv"})


def _playback_app(app: str) -> bool:
    return app in PLAYBACK_APPS

BTN_B = 304
BTN_A = 305
BTN_X = 307
BTN_Y = 308
BTN_MINUS = 314
BTN_PLUS = 315
BTN_TL = 310  # L shoulder — prev browse tab (launcher)
BTN_TR = 311  # R shoulder — next browse tab (launcher); home fallback elsewhere
BTN_CENTER = 317  # bottom-left center — unused on launcher; no playback subtitle role
HOME_BUTTONS = {316, 311}
DEVICE_SCAN_SLEEP_SEC = 0.25
DISPLAY_WAKE_THROTTLE_SEC = 3.0
STATUS_HEARTBEAT_SEC = 2.0
FOREGROUND_LAUNCHER_TTL_SEC = float(
    os.environ.get("MANGO_PAD_FOREGROUND_LAUNCHER_TTL_SEC", "2.0")
)
COUCH_ACTIVITY_THROTTLE_SEC = float(
    os.environ.get("MANGO_PAD_COUCH_ACTIVITY_THROTTLE_SEC", "0.5")
)


class DeviceNotFoundError(Exception):
    pass

DIAG_SESSION = os.environ.get("MANGO_DIAG_SESSION", "")
PAD_DEBUG = os.environ.get("MANGO_PAD_DEBUG") == "1"
PAD_NAV_API_ENABLED = os.environ.get("MANGO_PAD_NAV_API", "0") == "1"
PAD_NAV_TIMEOUT_SEC = float(os.environ.get("MANGO_PAD_NAV_TIMEOUT_SEC", "0.15"))
SECONDARY_HOLD_SEC = float(os.environ.get("MANGO_PAD_SECONDARY_HOLD_SEC", "0.6"))
_env = {"DISPLAY": DISPLAY, "XAUTHORITY": XAUTHORITY, "HOME": str(_HOME)}
_last_display_wake_at = 0.0
_last_couch_activity_at = 0.0


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
        "pad_nav_api": PAD_NAV_API_ENABLED,
    }
    payload.update(_device_payload(dev))
    _write_owner_file(STATUS_PATH, json.dumps(payload, separators=(",", ":")) + "\n")


def as_tv_user(argv: list[str]) -> list[str]:
    if os.geteuid() == 0 and _TV_USER not in ("", "root"):
        return ["sudo", "-u", _TV_USER, "-E", *argv]
    return argv


def _tv_env(extra_env: dict[str, str] | None = None) -> dict[str, str]:
    env = {**_env, **(extra_env or {})}
    ids = _tv_user_ids()
    if ids is not None:
        env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{ids[0]}")
    return env


def popen_tv_user(argv: list[str], *, extra_env: dict[str, str] | None = None) -> None:
    subprocess.Popen(
        as_tv_user(argv),
        env=_tv_env(extra_env),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def run_tv_user(
    argv: list[str],
    *,
    timeout: float = 2.0,
    extra_env: dict[str, str] | None = None,
) -> None:
    try:
        subprocess.run(
            as_tv_user(argv),
            env=_tv_env(extra_env),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def touch_couch_activity(hint: str) -> None:
    global _last_couch_activity_at
    if not COUCH_ACTIVITY_SH.is_file():
        return
    now = time.monotonic()
    if now - _last_couch_activity_at < COUCH_ACTIVITY_THROTTLE_SEC:
        return
    _last_couch_activity_at = now
    popen_tv_user(["bash", str(COUCH_ACTIVITY_SH), "touch", "pad", hint])


def _wake_display_xset() -> None:
    if not shutil.which("xset"):
        return
    for args in (
        ["-dpms"],
        ["s", "off"],
        ["s", "noblank"],
        ["s", "0", "0"],
        ["dpms", "force", "on"],
        ["s", "reset"],
    ):
        try:
            subprocess.run(
                ["xset", *args],
                env=_env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=0.5,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass


def wake_display_for_input(hint: str) -> None:
    global _last_display_wake_at
    touch_couch_activity(hint)
    now = time.monotonic()
    if now - _last_display_wake_at < DISPLAY_WAKE_THROTTLE_SEC:
        return
    _last_display_wake_at = now
    _wake_display_xset()


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


def _is_launcher_window_from_parts(
    wid: str, *, name: str, klass: str, process: str, cmdline: str
) -> bool:
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


def _is_launcher_window(wid: str) -> bool:
    return _is_launcher_window_from_parts(
        wid,
        name=_window_name(wid),
        klass=_window_class(wid),
        process=_window_process(wid),
        cmdline=_window_cmdline(wid),
    )


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


def route_mpv_seek(direction: str, seconds: int) -> None:
    if direction not in {"left", "right"} or seconds <= 0:
        return
    signed_seconds = -seconds if direction == "left" else seconds
    send_mpv_ipc("seek", str(signed_seconds), "relative")
    show_playback_osd(direction)


def route_playback_seek(app: str, direction: str, seconds: int) -> None:
    if app == "mpv":
        route_mpv_seek(direction, seconds)


def _mpv_window_ids() -> list[str]:
    result = _xdotool("search", "--class", "mpv")
    if result.returncode != 0 or not result.stdout.strip():
        return []
    return result.stdout.split()


def _playback_session_active() -> bool:
    """Foreground couch playback only — idle mpv-probe workers do not count."""
    if PLAYBACK_ACTIVE_FILE.is_file():
        return True
    if not MPV_SOCKET_PATH.is_socket():
        return False
    # Match the main IPC socket, not probe-*.sock idle workers.
    needle = f"--input-ipc-server={MPV_SOCKET_PATH}"
    result = subprocess.run(
        ["pgrep", "-af", f"mpv.*{needle}"],
        env=_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


_FOREGROUND_CACHE_TTL_SEC = 0.15
_foreground_cache: dict[str, object] = {"value": None, "expires_at": 0.0}
_launcher_wid_cache: dict[str, object] = {"wid": None, "expires_at": 0.0}


def invalidate_launcher_wid_cache() -> None:
    _launcher_wid_cache["wid"] = None
    _launcher_wid_cache["expires_at"] = 0.0


def invalidate_foreground_cache() -> None:
    """Drop memoized foreground_app() and launcher window id caches.

    Call after actions that change the active window (windowactivate,
    launching the launcher, stopping mpv) and from process_seek_hold during
    playback seek-hold so routing stays fresh. Not called on every evdev
    dispatch — browse hot path relies on TTL caches instead.
    """

    _foreground_cache["value"] = None
    _foreground_cache["expires_at"] = 0.0
    invalidate_launcher_wid_cache()


def foreground_app() -> str:
    now = time.monotonic()
    cached = _foreground_cache["value"]
    if cached is not None and now < float(_foreground_cache["expires_at"]):
        return str(cached)
    value = _resolve_foreground_app()
    _foreground_cache["value"] = value
    ttl = FOREGROUND_LAUNCHER_TTL_SEC if value == "launcher" else _FOREGROUND_CACHE_TTL_SEC
    _foreground_cache["expires_at"] = now + ttl
    return value


def routing_app() -> str:
    if _playback_session_active():
        return "mpv"
    return foreground_app()


def _resolve_foreground_app() -> str:
    wid = _xdotool("getactivewindow").stdout.strip()
    if not wid or wid == "0":
        return "other"

    name = _window_name(wid)
    klass = _window_class(wid)
    blob = f"{name} {klass}"

    if "mpv" in blob or wid in _mpv_window_ids():
        return "mpv"

    if "mango-overlay" in klass or "mango overlay" in name:
        return "launcher"
    if "mango-launcher" in blob or "mango launcher" in name:
        return "launcher"

    process = _window_process(wid)
    cmdline = _window_cmdline(wid)
    if _is_launcher_window_from_parts(
        wid, name=name, klass=klass, process=process, cmdline=cmdline
    ):
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


def get_launcher_wid(*, force: bool = False) -> str | None:
    now = time.monotonic()
    if not force:
        cached_wid = _launcher_wid_cache["wid"]
        if cached_wid is not None and now < float(_launcher_wid_cache["expires_at"]):
            return str(cached_wid)
    wid = find_launcher_wid()
    if wid:
        _launcher_wid_cache["wid"] = wid
        _launcher_wid_cache["expires_at"] = now + LAUNCHER_WID_TTL_SEC
    else:
        invalidate_launcher_wid_cache()
    return wid


def send_key_to_wid(wid: str, symbol: str, *, activate: bool = True) -> None:
    if activate:
        active = _xdotool("getactivewindow").stdout.strip()
        if active != wid:
            _xdotool("windowactivate", wid)
            invalidate_foreground_cache()
    _xdotool("key", "--clearmodifiers", "--window", wid, symbol)


def send_key_launcher(symbol: str, *, app: str | None = None) -> None:
    wid = get_launcher_wid()
    if not wid:
        return
    if app == "launcher" or (app is None and routing_app() == "launcher"):
        send_key_to_wid(wid, symbol, activate=False)
    else:
        send_key_to_wid(wid, symbol, activate=True)


def send_pad_nav(
    action: str,
    direction: str | None = None,
    delta: int | None = None,
    kind: str | None = None,
) -> bool:
    payload: dict[str, object] = {
        "type": "pad_nav",
        "action": action,
        "direction": direction,
        "delta": delta,
        "kind": kind,
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{LAUNCHER_PORT}/api/pad/nav",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=PAD_NAV_TIMEOUT_SEC) as resp:
            if getattr(resp, "status", None) != 200:
                if PAD_DEBUG:
                    print(
                        f"mango-tv-pad: pad-nav non-200 action={action} status={getattr(resp, 'status', 'unknown')}",
                        flush=True,
                    )
                return False
            raw = resp.read().decode("utf-8")
        parsed = json.loads(raw)
        ok = parsed.get("ok") is True if isinstance(parsed, dict) else False
        if not ok and PAD_DEBUG:
            print(f"mango-tv-pad: pad-nav bad body action={action}", flush=True)
        return ok
    except (
        urllib.error.URLError,
        urllib.error.HTTPError,
        TimeoutError,
        OSError,
        ValueError,
        json.JSONDecodeError,
    ) as exc:
        if PAD_DEBUG:
            print(f"mango-tv-pad: pad-nav failed action={action} err={type(exc).__name__}", flush=True)
        return False


def launcher_send_nav_or_key(
    symbol: str,
    *,
    app: str | None = None,
    action: str | None = None,
    direction: str | None = None,
    delta: int | None = None,
    kind: str | None = None,
) -> None:
    if PAD_NAV_API_ENABLED and routing_app() == "launcher" and action is not None:
        if send_pad_nav(action, direction=direction, delta=delta, kind=kind):
            return
    send_key_launcher(symbol, app=app)


def send_mpv_ipc(command: str, *args: str) -> bool:
    """Serialize pad commands through mpv's socket and wait for dispatch."""

    try:
        send_mpv_command(
            MPV_SOCKET_PATH,
            command,
            *args,
            timeout_sec=MPV_IPC_TIMEOUT_SEC,
        )
        return True
    except MpvIpcError as exc:
        if PAD_DEBUG:
            print(
                f"mango-tv-pad: mpv IPC failed command={command} error={exc}",
                flush=True,
            )
        return False


def mpv_ipc_data(property_name: str) -> object | None:
    try:
        result = subprocess.run(
            as_tv_user(["bash", str(MPV_IPC_SH), "get_property", property_name]),
            env=_tv_env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
            timeout=2.0,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return payload.get("data")


def _mpv_track_id_active(track_id: object) -> bool:
    if track_id is None:
        return False
    if isinstance(track_id, str):
        lowered = track_id.strip().lower()
        if lowered in {"", "no", "null"}:
            return False
        try:
            track_id = int(track_id)
        except ValueError:
            return lowered == "auto"
    if isinstance(track_id, (int, float)):
        return int(track_id) > 0
    return False


def _mpv_audio_track_ids() -> list[int]:
    tracks = mpv_ipc_data("track-list")
    if not isinstance(tracks, list):
        return []
    ids: list[int] = []
    for track in tracks:
        if not isinstance(track, dict) or track.get("type") != "audio":
            continue
        if track.get("invalid"):
            continue
        try:
            track_id = int(track.get("id"))
        except (TypeError, ValueError):
            continue
        if track_id <= 0:
            continue
        ids.append(track_id)
    return sorted(set(ids))


PLAYBACK_OSD_PID_FILE = Path(
    os.environ.get("MANGO_PLAYBACK_OSD_PID_FILE", str(CACHE_DIR / "playback-osd.pid"))
)
PLAYBACK_OSD_VISIBLE_FILE = Path(
    os.environ.get("MANGO_PLAYBACK_OSD_VISIBLE_FILE", str(CACHE_DIR / "playback-osd.visible"))
)
PLAYBACK_OSD_TRIGGER = Path(
    os.environ.get("MANGO_PLAYBACK_OSD_TRIGGER", str(CACHE_DIR / "playback-osd.show"))
)
PLAYBACK_OSD_VISIBLE_SEC = float(os.environ.get("MANGO_PLAYBACK_OSD_VISIBLE_SEC", "4.0"))
# Default HUD backend is the in-mpv Lua overlay (no external window → no 4K
# present stutter). "tk" restores the legacy Tkinter overlay for A/B only.
PLAYBACK_OSD_BACKEND = os.environ.get("MANGO_PLAYBACK_OSD_BACKEND", "lua")


def show_playback_osd(reason: str) -> None:
    if PLAYBACK_OSD_BACKEND == "lua":
        # HUD is rendered inside mpv; trigger it over the IPC socket.
        send_mpv_ipc("script-message", "mango-hud-show", reason)
        return
    if not PLAYBACK_OSD_PY.is_file():
        return
    ensure_playback_osd_daemon()
    popen_tv_user(["python3", str(PLAYBACK_OSD_PY), "--show", reason])


def playback_osd_is_visible() -> bool:
    """True when the playback HUD is currently shown (show-first gate)."""
    if PLAYBACK_OSD_VISIBLE_FILE.is_file():
        try:
            payload = json.loads(PLAYBACK_OSD_VISIBLE_FILE.read_text(encoding="utf-8"))
            if isinstance(payload, dict) and payload.get("visible") is True:
                ts = float(payload.get("ts") or 0)
                visible_sec = float(payload.get("visible_sec") or PLAYBACK_OSD_VISIBLE_SEC)
                if ts > 0 and (time.time() - ts) <= max(visible_sec, PLAYBACK_OSD_VISIBLE_SEC) + 0.5:
                    return True
                if ts <= 0:
                    return True
        except (OSError, ValueError, json.JSONDecodeError, TypeError):
            pass
    # Fallback: recent show trigger within visible window.
    try:
        age = time.time() - PLAYBACK_OSD_TRIGGER.stat().st_mtime
        return 0 <= age <= PLAYBACK_OSD_VISIBLE_SEC
    except OSError:
        return False


def playback_streams_open() -> bool:
    """The persistent in-mpv Streams panel owns D-pad/B/Y while open."""
    if not PLAYBACK_OSD_VISIBLE_FILE.is_file():
        return False
    try:
        payload = json.loads(PLAYBACK_OSD_VISIBLE_FILE.read_text(encoding="utf-8"))
        return (
            isinstance(payload, dict)
            and payload.get("visible") is True
            and payload.get("mode") == "streams"
        )
    except (OSError, ValueError, json.JSONDecodeError, TypeError):
        return False


def mpv_is_paused() -> bool:
    paused = mpv_ipc_data("pause")
    return paused in (True, "yes", 1)


def ensure_playback_osd_daemon() -> None:
    if not PLAYBACK_OSD_PY.is_file():
        return
    if PLAYBACK_OSD_PID_FILE.is_file():
        try:
            pid = int(PLAYBACK_OSD_PID_FILE.read_text(encoding="utf-8").strip() or "0")
        except ValueError:
            pid = 0
        if pid > 0:
            try:
                os.kill(pid, 0)
                return
            except OSError:
                pass
    popen_tv_user(
        ["python3", str(PLAYBACK_OSD_PY), "--run"],
        extra_env={
            "MANGO_REPO_DIR": str(REPO),
            "MANGO_PLAYBACK_OSD_PID_FILE": str(PLAYBACK_OSD_PID_FILE),
        },
    )


def stop_mpv_home() -> None:
    popen_tv_user(
        ["bash", str(MPV_STOP_SH)],
        extra_env={"MANGO_MPV_STOP_HOME": "1", "MANGO_SKIP_REMAPPER": "1"},
    )
    invalidate_foreground_cache()


def launcher_surface_active() -> bool:
    if foreground_app() == "launcher":
        return True
    return bool(_launcher_window_ids())


def send_launcher_key(symbol: str) -> None:
    send_key_launcher(symbol, app="launcher")


def switch_launcher_tab(delta: int) -> None:
    if not launcher_surface_active():
        return
    diag_event("tab_switch", foreground=foreground_app(), delta=str(delta))
    launcher_send_nav_or_key(
        symbol="F7" if delta > 0 else "F6",
        app="launcher",
        action="tab",
        delta=1 if delta > 0 else -1,
    )


def send_launcher_secondary(kind: str) -> None:
    # X is contextual, so the visible launcher must win over stale/background
    # playback state. Confirm the real X11 foreground instead of routing_app(),
    # whose playback override intentionally serves the mpv startup handoff.
    if _resolve_foreground_app() != "launcher":
        return
    normalized = "hold" if kind == "hold" else "tap"
    diag_event("secondary_press", foreground=foreground_app(), kind=normalized)
    if PAD_NAV_API_ENABLED and send_pad_nav("secondary", kind=normalized):
        return
    send_key_launcher("shift+F5" if normalized == "hold" else "F5", app="launcher")


def adjust_volume(delta_percent: int) -> None:
    if delta_percent == 0:
        return
    if routing_app() == "mpv":
        popen_tv_user(["bash", str(MPV_IPC_SH), "add", "volume", str(delta_percent)])
        show_playback_osd("volume")
        return
    delta = f"{abs(delta_percent)}%"
    if shutil.which("pactl"):
        change = f"+{delta}" if delta_percent > 0 else f"-{delta}"
        run_tv_user(["pactl", "set-sink-volume", "@DEFAULT_SINK@", change], timeout=2.0)
        return
    if shutil.which("wpctl"):
        suffix = "+" if delta_percent > 0 else "-"
        run_tv_user(
            ["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", f"{delta}{suffix}"],
            timeout=2.0,
        )


def go_home() -> None:
    name, klass = active_window_meta()
    app = routing_app()
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
                invalidate_foreground_cache()
        return
    diag_event("home_press", foreground=app, active_name=name, active_class=klass)
    if app == "mpv":
        print("mango-tv-pad: home -> mpv-stop.sh + launcher (mpv)", flush=True)
        stop_mpv_home()
        return
    print("mango-tv-pad: home -> launch-launcher.sh", flush=True)
    popen_tv_user(
        ["bash", str(LAUNCHER_SH)],
        extra_env={"MANGO_SKIP_PAD_STOP": "1", "MANGO_SKIP_REMAPPER": "1"},
    )
    invalidate_foreground_cache()


def route_playback_up(app: str) -> None:
    """↑ sole subtitle control: show-first, then force-on + cycle languages."""
    if app != "mpv":
        return
    if not playback_osd_is_visible():
        show_playback_osd("show")
        return
    send_mpv_ipc("set_property", "sub-visibility", "yes")
    send_mpv_ipc("cycle", "sub", "up")
    show_playback_osd("subs")


def route_playback_audio(app: str) -> None:
    """A show-first: first press shows HUD; while visible, cycle audio."""
    if app != "mpv":
        return
    if not playback_osd_is_visible():
        show_playback_osd("show")
        return
    audio_ids = _mpv_audio_track_ids()
    if not audio_ids:
        show_playback_osd("audio")
        return
    current = mpv_ipc_data("aid")
    current_id: int | None = None
    if _mpv_track_id_active(current):
        try:
            current_id = int(current)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            current_id = None
    if current_id not in audio_ids:
        next_id = audio_ids[0]
    else:
        next_id = audio_ids[(audio_ids.index(current_id) + 1) % len(audio_ids)]
    send_mpv_ipc("set_property", "aid", str(next_id))
    show_playback_osd("audio")


def route_dpad(app: str, direction: str) -> None:
    symbol = {"left": "Left", "right": "Right", "up": "Up", "down": "Down"}[direction]
    if app == "mpv":
        if playback_streams_open():
            if direction in {"up", "down"}:
                send_mpv_ipc(
                    "script-message",
                    "mango-streams-move",
                    "-1" if direction == "up" else "1",
                )
            return
        if direction in {"left", "right"}:
            route_mpv_seek(direction, PLAYBACK_SEEK_STEP_SEC)
        else:
            send_mpv_ipc("keypress", symbol.upper())
    elif app == "launcher":
        launcher_send_nav_or_key(
            symbol=symbol,
            app=app,
            action="move",
            direction=direction,
        )


def route_playback_shoulder(app: str, direction: str) -> None:
    route_playback_seek(app, direction, PLAYBACK_SHOULDER_SEEK_STEP_SEC)


def route_face(app: str, action: str) -> None:
    if action == "select":
        if app == "mpv":
            if playback_streams_open():
                send_mpv_ipc("script-message", "mango-streams-select")
                return
            resuming = mpv_is_paused()
            send_mpv_ipc("keypress", "SPACE")
            # HDMI mode is owned by mpv-play start/stop — never reassert on pause.
            show_playback_osd("resume" if resuming else "pause")
        elif app == "launcher":
            launcher_send_nav_or_key(
                symbol="Return",
                app=app,
                action="select",
            )
    elif action == "back":
        if app == "mpv":
            if playback_streams_open():
                send_mpv_ipc("script-message", "mango-streams-close")
                return
            stop_mpv_home()
        elif app == "launcher":
            launcher_send_nav_or_key(
                symbol="BackSpace",
                app=app,
                action="back",
            )


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


def wait_for_device() -> evdev.InputDevice:
    last_wait_log_at = 0.0
    while True:
        try:
            return find_pro_controller()
        except DeviceNotFoundError:
            write_status("waiting", last_action="device_scan")
            now = time.monotonic()
            if now - last_wait_log_at >= WAIT_LOG_INTERVAL_SEC:
                print("mango-tv-pad: waiting for Pro Controller (link supervisor active)", flush=True)
                last_wait_log_at = now
            time.sleep(DEVICE_SCAN_SLEEP_SEC)


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
    last_heartbeat_at = time.monotonic()
    hold_seek: dict[str, object] = {}
    secondary_press: dict[str, object] = {}
    write_status("running", dev, last_event_at=last_event_at, last_action="grabbed")

    def debounced(action: str, fn, *, debounce_sec: float | None = None) -> None:
        interval = DEBOUNCE_SEC if debounce_sec is None else debounce_sec
        now = time.monotonic()
        if now - last.get(action, 0) < interval:
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

    def stop_seek_hold() -> None:
        hold_seek.clear()

    def held_seek_step(held_for_sec: float) -> int:
        if held_for_sec >= PLAYBACK_HOLD_SEEK_BIG_AFTER_SEC:
            return PLAYBACK_SEEK_BIG_STEP_SEC
        if held_for_sec >= PLAYBACK_HOLD_SEEK_FAST_AFTER_SEC:
            return PLAYBACK_SEEK_FAST_STEP_SEC
        return PLAYBACK_SEEK_STEP_SEC

    def start_or_update_seek_hold(app: str, direction: str) -> None:
        if not _playback_app(app):
            stop_seek_hold()
            debounced(
                f"{app}-{direction}",
                lambda: route_dpad(app, direction),
                debounce_sec=DPAD_DEBOUNCE_SEC,
            )
            return
        now = time.monotonic()
        if hold_seek.get("direction") == direction:
            return
        wake_display_for_input(f"{app}-{direction}")
        route_playback_seek(app, direction, PLAYBACK_SEEK_STEP_SEC)
        hold_seek.update(
            {
                "app": app,
                "direction": direction,
                "started_at": now,
                "next_at": now + PLAYBACK_HOLD_SEEK_DELAY_SEC,
            }
        )

    def process_seek_hold() -> None:
        if not hold_seek:
            return
        invalidate_foreground_cache()
        hold_app = str(hold_seek.get("app") or "")
        if routing_app() != hold_app or not _playback_app(hold_app):
            stop_seek_hold()
            return
        now = time.monotonic()
        next_at = float(hold_seek.get("next_at") or 0.0)
        if now < next_at:
            return
        direction = str(hold_seek.get("direction") or "")
        if direction not in {"left", "right"}:
            stop_seek_hold()
            return
        held_for = now - float(hold_seek.get("started_at") or now)
        route_playback_seek(hold_app, direction, held_seek_step(held_for))
        hold_seek["next_at"] = now + PLAYBACK_HOLD_SEEK_REPEAT_SEC

    def select_timeout() -> float:
        timeout = STATUS_HEARTBEAT_SEC
        if hold_seek:
            next_at = float(hold_seek.get("next_at") or 0.0)
            timeout = min(timeout, max(0.0, next_at - time.monotonic()))
        return timeout

    try:
        while True:
            ready, _, _ = select.select([dev.fd], [], [], select_timeout())
            if not ready:
                process_seek_hold()
                now = time.monotonic()
                if now - last_heartbeat_at >= STATUS_HEARTBEAT_SEC:
                    if not heartbeat():
                        return
                    last_heartbeat_at = now
                continue
            for event in dev.read():
                last_event_at = time.time()
                app = routing_app()
                if event.type == ecodes.EV_ABS:
                    if event.code in (ecodes.ABS_X, ecodes.ABS_HAT0X):
                        threshold = 1 if event.code == ecodes.ABS_HAT0X else THRESH
                        if _playback_app(app) and playback_streams_open():
                            stop_seek_hold()
                        elif event.value <= -threshold:
                            start_or_update_seek_hold(app, "left")
                        elif event.value >= threshold:
                            start_or_update_seek_hold(app, "right")
                        else:
                            stop_seek_hold()
                    elif event.code in (ecodes.ABS_Y, ecodes.ABS_HAT0Y):
                        threshold = 1 if event.code == ecodes.ABS_HAT0Y else THRESH
                        stop_seek_hold()
                        if _playback_app(app):
                            if event.value <= -threshold:
                                debounced(
                                    f"{app}-up",
                                    lambda: (
                                        route_dpad(app, "up")
                                        if playback_streams_open()
                                        else route_playback_up(app)
                                    ),
                                    debounce_sec=DPAD_DEBOUNCE_SEC,
                                )
                            elif event.value >= threshold and playback_streams_open():
                                debounced(
                                    f"{app}-down",
                                    lambda: route_dpad(app, "down"),
                                    debounce_sec=DPAD_DEBOUNCE_SEC,
                                )
                        elif event.value <= -threshold:
                            debounced(
                                f"{app}-up",
                                lambda: route_dpad(app, "up"),
                                debounce_sec=DPAD_DEBOUNCE_SEC,
                            )
                        elif event.value >= threshold:
                            debounced(
                                f"{app}-down",
                                lambda: route_dpad(app, "down"),
                                debounce_sec=DPAD_DEBOUNCE_SEC,
                            )
                elif event.type == ecodes.EV_KEY and event.code == BTN_X:
                    if event.value == 1:
                        x_surface = contextual_secondary_surface(
                            _resolve_foreground_app(),
                            _playback_session_active(),
                        )
                        if x_surface == "mpv":
                            wake_display_for_input("mpv-streams")
                            debounced(
                                "mpv-streams-toggle",
                                lambda: send_mpv_ipc("script-message", "mango-streams-toggle"),
                            )
                        elif x_surface == "launcher":
                            secondary_press.update(
                                {
                                    "started_at": time.monotonic(),
                                    "app": x_surface,
                                }
                            )
                            wake_display_for_input("launcher-secondary")
                    elif event.value == 0 and secondary_press:
                        started_at = float(secondary_press.get("started_at") or time.monotonic())
                        press_app = str(secondary_press.get("app") or app)
                        secondary_press.clear()
                        if press_app == "launcher":
                            kind = secondary_press_kind(
                                started_at,
                                time.monotonic(),
                                SECONDARY_HOLD_SEC,
                            )
                            debounced(
                                f"secondary-{kind}",
                                lambda kind=kind: send_launcher_secondary(kind),
                            )
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
                    elif event.code == BTN_A and _playback_app(app):
                        debounced(
                            f"{app}-audio-cycle",
                            lambda: route_playback_audio(app),
                        )
                    elif event.code == BTN_CENTER and _playback_app(app):
                        # No playback subtitle role — ↑ is sole subtitle control.
                        pass
                    elif event.code == BTN_MINUS:
                        debounced("volume-down", lambda: adjust_volume(-VOLUME_STEP_PERCENT))
                    elif event.code == BTN_PLUS:
                        debounced("volume-up", lambda: adjust_volume(VOLUME_STEP_PERCENT))
                    elif app == "mpv" and event.code == BTN_TL:
                        debounced(f"{app}-seek-big-back", lambda: route_playback_shoulder(app, "left"))
                    elif app == "mpv" and event.code == BTN_TR:
                        debounced(f"{app}-seek-big-forward", lambda: route_playback_shoulder(app, "right"))
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
        time.sleep(DEVICE_SCAN_SLEEP_SEC)


if __name__ == "__main__":
    main()
