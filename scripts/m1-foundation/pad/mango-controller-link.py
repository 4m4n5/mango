#!/usr/bin/env python3
"""BlueZ-only connection owner for Mango's dedicated 8BitDo Micro.

This service deliberately does not read evdev or route controller input. The
separate mango-tv-pad router owns input only after BlueZ has created its node.

Ownership rule: mango-controller-link is the sole Connect() caller. BlueZ Policy
auto-reconnect must stay disabled (ReconnectAttempts=0) so host-side storms do
not race Switch/Pro ordinary wake.
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

from controller_link_state import (
    ASLEEP_PROBE_SEC,
    ASLEEP_SCAN_SEC,
    DISCONNECT_GRACE_SEC,
    FAST_RETRY_DELAYS_SEC,
    MAINTENANCE_RETRY_SEC,
    LinkRetryState,
)

TV_USER = os.environ.get("MANGO_TV_USER", "aman")
BT_MAC = os.environ.get("MANGO_GAMEPAD_BT_MAC", "E4:17:D8:EB:00:44").upper()
ADAPTER_PATH = os.environ.get("MANGO_BT_ADAPTER_PATH", "/org/bluez/hci0")
DEVICE_PATH = f"{ADAPTER_PATH}/dev_{BT_MAC.replace(':', '_')}"
CACHE_DIR = Path(f"/home/{TV_USER}/.cache/mango")
STATUS_PATH = CACHE_DIR / "mango-controller-link-status.json"
STATUS_HEARTBEAT_SEC = 2.0
AUTO_REPAIR_COOLDOWN_SEC = 15 * 60.0
CONNECT_ATTEMPT_TIMEOUT_SEC = 8.0
# Short inquiry bursts while awaiting the bonded Micro; Connect probes are the
# primary ordinary-wake path and must not wait on a long dark gap.
DEVICE_DISCOVERY_DURATION_SEC = 2
PAIRING_POLICY = "explicit_recovery_only"


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


def asleep_scan_from_env() -> float:
    try:
        value = float(os.environ.get("MANGO_CONTROLLER_ASLEEP_SCAN_SEC", ASLEEP_SCAN_SEC))
    except ValueError:
        return ASLEEP_SCAN_SEC
    return value if value >= 1.0 else ASLEEP_SCAN_SEC


def asleep_probe_from_env() -> float:
    try:
        value = float(os.environ.get("MANGO_CONTROLLER_ASLEEP_PROBE_SEC", ASLEEP_PROBE_SEC))
    except ValueError:
        return ASLEEP_PROBE_SEC
    return value if value >= 0.5 else ASLEEP_PROBE_SEC


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
            asleep_scan_sec=asleep_scan_from_env(),
            asleep_probe_sec=asleep_probe_from_env(),
            disconnect_grace_sec=DISCONNECT_GRACE_SEC,
        )
        DBusGMainLoop(set_as_default=True)
        self.bus = dbus.SystemBus()
        self.device = None
        self.device_props = None
        self.adapter = dbus.Interface(
            self.bus.get_object("org.bluez", ADAPTER_PATH), "org.bluez.Adapter1"
        )
        self.adapter_props = dbus.Interface(
            self.bus.get_object("org.bluez", ADAPTER_PATH), "org.freedesktop.DBus.Properties"
        )
        self.last_status_at = 0.0
        self.last_repair_at = 0.0
        self.last_repair_wall_at = 0.0
        self.last_connected_wall_at = 0.0
        self.last_disconnect_wall_at = 0.0
        self.last_discovery_at = 0.0
        self.last_discovery_wall_at = 0.0
        self.discovery_active = False
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
        self.bus.add_signal_receiver(
            self._interfaces_added,
            dbus_interface="org.freedesktop.DBus.ObjectManager",
            signal_name="InterfacesAdded",
            path="/",
        )
        self._enforce_adapter_policy()
        self._resolve_device()
        self._sync_initial_state()

    def _device_connected(self) -> bool:
        if self.device_props is None:
            raise RuntimeError("device_object_missing")
        return bool(self.device_props.Get("org.bluez.Device1", "Connected"))

    def _device_paired(self) -> bool:
        if self.device_props is None:
            raise RuntimeError("device_object_missing")
        return bool(self.device_props.Get("org.bluez.Device1", "Paired"))

    def _adapter_powered(self) -> bool:
        return bool(self.adapter_props.Get("org.bluez.Adapter1", "Powered"))

    def _enforce_adapter_policy(self) -> None:
        """Keep the adapter connectable for the bonded Micro without pairable spam."""
        try:
            if bool(self.adapter_props.Get("org.bluez.Adapter1", "Pairable")):
                self.adapter_props.Set("org.bluez.Adapter1", "Pairable", dbus.Boolean(False))
            if bool(self.adapter_props.Get("org.bluez.Adapter1", "Discoverable")):
                self.adapter_props.Set("org.bluez.Adapter1", "Discoverable", dbus.Boolean(False))
        except dbus.DBusException as exc:
            self.retry.last_error = f"adapter_policy:{exc}"

    def _sync_initial_state(self) -> None:
        now = time.monotonic()
        try:
            paired = self._device_paired()
            self.retry.mark_device_resolved(now, paired=paired)
            if self._device_connected():
                self.retry.mark_connected(now)
                self.last_connected_wall_at = time.time()
            else:
                # At start with a bonded-but-off Micro, await peripheral wake
                # instead of immediately Connect()-storming.
                self.retry.mark_disconnected(now)
                self.retry.mark_peripheral_asleep(now, "awaiting_bonded_peripheral")
        except (dbus.DBusException, RuntimeError) as exc:
            self.retry.last_error = str(exc)
            if self._is_missing_device_error(self.retry.last_error):
                self.retry.mark_device_missing(now, self.retry.last_error)
            else:
                self.retry.mark_disconnected(now)
                self.retry.mark_peripheral_asleep(now, self.retry.last_error)
        self.write_status()

    def _bind_device(self) -> None:
        obj = self.bus.get_object("org.bluez", DEVICE_PATH)
        self.device = dbus.Interface(obj, "org.bluez.Device1")
        self.device_props = dbus.Interface(obj, "org.freedesktop.DBus.Properties")

    def _resolve_device(self) -> bool:
        """Rebind the configured MAC after BlueZ recreates its Device1 object."""
        now = time.monotonic()
        try:
            self._bind_device()
            paired = self._device_paired()
        except (dbus.DBusException, RuntimeError) as exc:
            message = str(exc)
            if self._is_missing_device_error(message):
                self.device = None
                self.device_props = None
                self.retry.mark_device_missing(now, message)
                return False
            self.retry.last_error = message
            return False
        self.retry.mark_device_resolved(now, paired=paired)
        return True

    def _interfaces_added(self, path: str, interfaces: dict[str, Any]) -> None:
        if str(path) != DEVICE_PATH or "org.bluez.Device1" not in interfaces:
            return
        if self._resolve_device() and not self.retry.connected:
            self.retry.mark_wake_detected(time.monotonic())
        self.write_status(force=True)

    def _properties_changed(
        self,
        interface: str,
        changed: dict[str, Any],
        _invalidated: list[str],
    ) -> None:
        now = time.monotonic()
        if interface == "org.bluez.Device1":
            if "Paired" in changed:
                self.retry.paired = bool(changed["Paired"])
            if "Connected" in changed:
                if bool(changed["Connected"]):
                    self.retry.mark_connected(now)
                    self.last_connected_wall_at = time.time()
                    if self.discovery_active:
                        self._stop_discovery()
                else:
                    self.retry.mark_disconnected(now)
                    self.last_disconnect_wall_at = time.time()
            # Inbound advertising evidence means the Micro woke. Do not treat a
            # bare Name refresh (common on bluetoothd restart) as wake.
            if "RSSI" in changed or "ManufacturerData" in changed or "ServiceData" in changed:
                self.retry.mark_wake_detected(now)
            elif "ServicesResolved" in changed and bool(changed.get("ServicesResolved")):
                self.retry.mark_wake_detected(now)
            self.write_status(force=True)
        elif interface == "org.bluez.Adapter1":
            if "Powered" in changed and not bool(changed["Powered"]):
                self.retry.last_error = "adapter_powered_off"
            elif not self.retry.connected:
                self._resolve_device()
                self.retry.mark_wake_detected(now)
            if "Pairable" in changed and bool(changed["Pairable"]):
                self._enforce_adapter_policy()
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
        now = time.monotonic()
        if self._is_missing_device_error(message):
            self.device = None
            self.device_props = None
            self.retry.mark_device_missing(now, message)
        else:
            self.retry.complete_attempt(now, message)
        self.write_status(force=True)

    @staticmethod
    def _is_missing_device_error(message: str) -> bool:
        return (
            "DoesNotExist" in message
            or "UnknownObject" in message
            or "device_object_missing" in message
        )

    def _stop_discovery(self) -> bool:
        if not self.discovery_active:
            return False
        try:
            self.adapter.StopDiscovery()
        except dbus.DBusException as exc:
            self.retry.last_error = f"device_discovery_stop:{exc}"
        self.discovery_active = False
        self._resolve_device()
        now = time.monotonic()
        # Do not invent wake evidence after an empty inquiry — Connect probes
        # own ordinary paging. Restart inquiry soon if still awaiting.
        if not self.retry.connected and (
            self.retry.peripheral_asleep or not self.retry.device_present
        ):
            self.retry.next_scan_at = now
        self.write_status(force=True)
        return False

    def _maybe_discover_known_device(self) -> None:
        """Brief inquiry for advertising evidence; never make the adapter pairable."""
        now = time.monotonic()
        if self.discovery_active:
            return
        if not self.retry.scan_due(now):
            return
        self.retry.next_scan_at = now + self.retry.asleep_scan_sec
        self.last_discovery_at = now
        self.last_discovery_wall_at = time.time()
        self._enforce_adapter_policy()
        try:
            self.adapter.StartDiscovery()
        except dbus.DBusException as exc:
            self.retry.last_error = f"device_discovery_start:{exc}"
            return
        self.discovery_active = True
        GLib.timeout_add_seconds(DEVICE_DISCOVERY_DURATION_SEC, self._stop_discovery)

    def _try_connect(self) -> None:
        now = time.monotonic()
        if self.retry.needs_re_pair:
            return
        # Inquiry helps RSSI wake evidence; sole-owner Connect probes page the
        # bonded Micro without waiting on a long discovery dark window.
        if self.retry.peripheral_asleep or not self.retry.device_present:
            self._maybe_discover_known_device()
        if not self.retry.due(now):
            return
        try:
            if not self._adapter_powered():
                self.retry.last_error = "adapter_powered_off"
                self.retry.complete_attempt(time.monotonic(), self.retry.last_error)
                return
            if not self.retry.device_present or self.device is None:
                if not self._resolve_device():
                    self.retry.begin_attempt(now)
                    self.retry.complete_attempt(now, "device_object_missing")
                    self._maybe_discover_known_device()
                    return
            self._enforce_adapter_policy()
            self.retry.begin_attempt(now)
            assert self.device is not None
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
        self.device = None
        self.device_props = None
        self.retry.device_present = False
        self.retry.paired = None
        self.retry.force_retry(time.monotonic())
        self.write_status(force=True)

    def request_repair(self, _signum: int, _frame: object) -> None:
        self.force_repair_requested = True

    def request_retry(self, _signum: int, _frame: object) -> None:
        self._resolve_device()
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
            paired = self._device_paired()
            self.retry.device_present = True
            self.retry.paired = paired
        except (dbus.DBusException, RuntimeError) as exc:
            adapter_ready = self._adapter_powered_safe()
            connected = False
            self.retry.last_error = str(exc)
            if self._is_missing_device_error(self.retry.last_error):
                self.retry.device_present = False
                self.retry.paired = None
        if connected and not self.retry.connected:
            self.retry.mark_connected(now)
        input_ready = self._input_ready()
        state = self.retry.couch_state(adapter_ready=adapter_ready, input_ready=input_ready)
        payload = {
            "ok": adapter_ready and state != "needs_re-pair",
            "state": state,
            "retry_phase": self.retry.retry_phase,
            "connected": connected,
            "adapter_ready": adapter_ready,
            "device_present": self.retry.device_present,
            "paired": self.retry.paired,
            "input_ready": input_ready,
            "attempt_in_flight": self.retry.attempt_in_flight,
            "retry_index": self.retry.retry_index,
            "peripheral_asleep": self.retry.peripheral_asleep,
            "wake_detected": self.retry.wake_detected,
            "next_attempt_at": time.time() + max(0.0, self.retry.next_attempt_at - now),
            "last_error": self.retry.last_error,
            "last_connected_at": self.last_connected_wall_at or None,
            "last_disconnect_at": self.last_disconnect_wall_at or None,
            "last_repair_at": self.last_repair_wall_at or None,
            "repair_count": self.repair_count,
            "discovery_active": self.discovery_active,
            "last_discovery_at": self.last_discovery_wall_at or None,
            "pairing_policy": PAIRING_POLICY,
            "pid": os.getpid(),
            "updated_at": time.time(),
            "device_mac": BT_MAC,
            "device_path": DEVICE_PATH,
        }
        write_json(STATUS_PATH, payload)

    def _adapter_powered_safe(self) -> bool:
        try:
            return self._adapter_powered()
        except dbus.DBusException:
            return False

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
        else:
            self._enforce_adapter_policy()
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
