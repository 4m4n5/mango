#!/usr/bin/env python3
"""BlueZ-only connection owner for Mango's dedicated 8BitDo Micro.

This service deliberately does not read evdev or route controller input. The
separate mango-tv-pad router owns input only after BlueZ has created its node.
"""

from __future__ import annotations

import json
import os
import pwd
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

try:
    import dbus
    from dbus.mainloop.glib import DBusGMainLoop
    from gi.repository import GLib
except ImportError as exc:  # pragma: no cover - exercised on the Pi only
    sys.exit(f"mango-controller-link: missing Pi dependency: {exc}")

from controller_link_state import FAST_RETRY_DELAYS_SEC, MAINTENANCE_RETRY_SEC, LinkRetryState

TV_USER = os.environ.get("MANGO_TV_USER", "aman")
BT_MAC = os.environ.get("MANGO_GAMEPAD_BT_MAC", "E4:17:D8:EB:00:44").upper()
ADAPTER_PATH = os.environ.get("MANGO_BT_ADAPTER_PATH", "/org/bluez/hci0")
DEVICE_PATH = f"{ADAPTER_PATH}/dev_{BT_MAC.replace(':', '_')}"
CACHE_DIR = Path(f"/home/{TV_USER}/.cache/mango")
STATUS_PATH = CACHE_DIR / "mango-controller-link-status.json"
STATUS_HEARTBEAT_SEC = 2.0
AUTO_REPAIR_COOLDOWN_SEC = 15 * 60.0
CONNECT_ATTEMPT_TIMEOUT_SEC = 3.0


def retry_delays_from_env() -> tuple[float, ...]:
    raw = os.environ.get("MANGO_CONTROLLER_FAST_RETRY_DELAYS_SEC", "")
    if not raw:
        return FAST_RETRY_DELAYS_SEC
    try:
        values = tuple(float(value.strip()) for value in raw.split(","))
    except ValueError:
        return FAST_RETRY_DELAYS_SEC
    return values if len(values) >= 2 and all(value >= 0 for value in values) else FAST_RETRY_DELAYS_SEC


def maintenance_retry_from_env() -> float:
    try:
        value = float(os.environ.get("MANGO_CONTROLLER_MAINTENANCE_RETRY_SEC", MAINTENANCE_RETRY_SEC))
    except ValueError:
        return MAINTENANCE_RETRY_SEC
    return value if value >= 1.0 else MAINTENANCE_RETRY_SEC


def _owner_ids() -> tuple[int, int] | None:
    try:
        entry = pwd.getpwnam(TV_USER)
    except KeyError:
        return None
    return entry.pw_uid, entry.pw_gid


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temp.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    os.chmod(temp, 0o644)
    ids = _owner_ids()
    if ids is not None:
        os.chown(temp, *ids)
    temp.replace(path)
    if ids is not None:
        os.chown(path, *ids)


class ControllerLinkSupervisor:
    def __init__(self) -> None:
        self.retry = LinkRetryState(
            fast_retry_delays_sec=retry_delays_from_env(),
            maintenance_retry_sec=maintenance_retry_from_env(),
        )
        DBusGMainLoop(set_as_default=True)
        self.bus = dbus.SystemBus()
        self.device = dbus.Interface(
            self.bus.get_object("org.bluez", DEVICE_PATH), "org.bluez.Device1"
        )
        self.device_props = dbus.Interface(
            self.bus.get_object("org.bluez", DEVICE_PATH), "org.freedesktop.DBus.Properties"
        )
        self.adapter_props = dbus.Interface(
            self.bus.get_object("org.bluez", ADAPTER_PATH), "org.freedesktop.DBus.Properties"
        )
        self.last_status_at = 0.0
        self.last_repair_at = 0.0
        self.last_repair_wall_at = 0.0
        self.last_connected_wall_at = 0.0
        self.last_disconnect_wall_at = 0.0
        self.pairing_missing = False
        self.repair_count = 0
        self.force_repair_requested = False
        self.bus.add_signal_receiver(
            self._properties_changed,
            dbus_interface="org.freedesktop.DBus.Properties",
            signal_name="PropertiesChanged",
            path=DEVICE_PATH,
        )
        self.bus.add_signal_receiver(
            self._properties_changed,
            dbus_interface="org.freedesktop.DBus.Properties",
            signal_name="PropertiesChanged",
            path=ADAPTER_PATH,
        )
        self._sync_initial_state()

    def _device_connected(self) -> bool:
        return bool(self.device_props.Get("org.bluez.Device1", "Connected"))

    def _adapter_powered(self) -> bool:
        return bool(self.adapter_props.Get("org.bluez.Adapter1", "Powered"))

    def _sync_initial_state(self) -> None:
        now = time.monotonic()
        try:
            if self._device_connected():
                self.retry.mark_connected(now)
                self.last_connected_wall_at = time.time()
            else:
                self.retry.mark_disconnected(now)
        except dbus.DBusException as exc:
            self.retry.last_error = str(exc)
            self.pairing_missing = self._is_missing_device_error(self.retry.last_error)
            self.retry.mark_disconnected(now)
        self.write_status()

    def _properties_changed(
        self,
        interface: str,
        changed: dict[str, Any],
        _invalidated: list[str],
    ) -> None:
        now = time.monotonic()
        if interface == "org.bluez.Device1" and "Connected" in changed:
            if bool(changed["Connected"]):
                self.retry.mark_connected(now)
                self.last_connected_wall_at = time.time()
            else:
                self.retry.mark_disconnected(now)
                self.last_disconnect_wall_at = time.time()
            self.write_status(force=True)
        elif interface == "org.bluez.Adapter1" and "Powered" in changed:
            if not bool(changed["Powered"]):
                self.retry.last_error = "adapter_powered_off"
            self.write_status(force=True)

    def _connect_ok(self) -> None:
        # A PropertiesChanged signal is authoritative. A method success only
        # means BlueZ accepted the request, so keep waiting for that signal.
        if not self.retry.attempt_in_flight:
            return
        self.retry.complete_attempt(time.monotonic())
        self.write_status(force=True)

    def _connect_error(self, error: dbus.DBusException) -> None:
        if not self.retry.attempt_in_flight:
            return
        message = str(error)
        self.pairing_missing = self._is_missing_device_error(message)
        self.retry.complete_attempt(time.monotonic(), message)
        self.write_status(force=True)

    @staticmethod
    def _is_missing_device_error(message: str) -> bool:
        return "DoesNotExist" in message or "UnknownObject" in message

    def _try_connect(self) -> None:
        if self.pairing_missing:
            return
        if not self.retry.due(time.monotonic()):
            return
        try:
            if not self._adapter_powered():
                self.retry.last_error = "adapter_powered_off"
                self.retry.complete_attempt(time.monotonic(), self.retry.last_error)
                return
            self.retry.begin_attempt(time.monotonic())
            self.device.Connect(reply_handler=self._connect_ok, error_handler=self._connect_error)
        except dbus.DBusException as exc:
            self.retry.complete_attempt(time.monotonic(), str(exc))

    def _input_ready(self) -> bool:
        try:
            pad = json.loads((CACHE_DIR / "mango-tv-pad-status.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False
        return pad.get("state") == "running" and bool(pad.get("device_path"))

    def _repair_bluez(self) -> None:
        now = time.monotonic()
        if now - self.last_repair_at < AUTO_REPAIR_COOLDOWN_SEC:
            return
        self.last_repair_at = now
        self.last_repair_wall_at = time.time()
        self.repair_count += 1
        self.retry.last_error = "bluez_repair_requested"
        try:
            subprocess.run(
                ["systemctl", "restart", "bluetooth.service"],
                check=False,
                timeout=20,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError as exc:
            self.retry.last_error = f"bluez_repair_failed:{type(exc).__name__}"
        self.pairing_missing = False
        self.retry.force_retry(time.monotonic())
        self.write_status(force=True)

    def request_repair(self, _signum: int, _frame: object) -> None:
        self.force_repair_requested = True

    def request_retry(self, _signum: int, _frame: object) -> None:
        self.pairing_missing = False
        self.retry.force_retry(time.monotonic())
        self.write_status(force=True)

    def write_status(self, *, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self.last_status_at < STATUS_HEARTBEAT_SEC:
            return
        self.last_status_at = now
        try:
            adapter_ready = self._adapter_powered()
            connected = self._device_connected()
        except dbus.DBusException as exc:
            adapter_ready = False
            connected = False
            self.retry.last_error = str(exc)
        if connected and not self.retry.connected:
            self.retry.mark_connected(now)
        state = "ready" if connected and self._input_ready() else "connected_waiting_for_input" if connected else self.retry.phase
        if self.pairing_missing:
            state = "needs_repair"
        elif not adapter_ready:
            state = "needs_repair"
        payload = {
            "ok": state != "needs_repair",
            "state": state,
            "connected": connected,
            "adapter_ready": adapter_ready,
            "input_ready": self._input_ready(),
            "attempt_in_flight": self.retry.attempt_in_flight,
            "retry_index": self.retry.retry_index,
            "next_attempt_at": time.time() + max(0.0, self.retry.next_attempt_at - now),
            "last_error": self.retry.last_error,
            "last_connected_at": self.last_connected_wall_at or None,
            "last_disconnect_at": self.last_disconnect_wall_at or None,
            "last_repair_at": self.last_repair_wall_at or None,
            "repair_count": self.repair_count,
            "pid": os.getpid(),
            "updated_at": time.time(),
            "device_mac": BT_MAC,
            "device_path": DEVICE_PATH,
        }
        write_json(STATUS_PATH, payload)

    def tick(self) -> bool:
        if self.force_repair_requested:
            self.force_repair_requested = False
            self._repair_bluez()
        now = time.monotonic()
        if self.retry.attempt_in_flight and now - self.retry.attempt_started_at >= CONNECT_ATTEMPT_TIMEOUT_SEC:
            self.retry.complete_attempt(now, "connect_attempt_timeout")
        try:
            adapter_ready = self._adapter_powered()
        except dbus.DBusException as exc:
            adapter_ready = False
            self.retry.last_error = str(exc)
        if not adapter_ready:
            # This is adapter/daemon evidence, unlike an off controller. The
            # repair routine is rate-limited and never runs for ordinary link
            # misses.
            self._repair_bluez()
        self._try_connect()
        self.write_status()
        return True


def main() -> int:
    supervisor = ControllerLinkSupervisor()
    signal.signal(signal.SIGUSR1, supervisor.request_retry)
    signal.signal(signal.SIGUSR2, supervisor.request_repair)
    GLib.timeout_add(250, supervisor.tick)
    print(f"mango-controller-link: supervising {BT_MAC}", flush=True)
    GLib.MainLoop().run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
