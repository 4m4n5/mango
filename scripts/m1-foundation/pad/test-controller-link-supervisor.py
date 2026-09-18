#!/usr/bin/env python3
"""D-Bus boundary regressions; no Bluetooth hardware or daemon is required."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent))
from controller_link_state import LinkRetryState

dbus = types.ModuleType("dbus")
dbus.DBusException = type("DBusException", (Exception,), {})
dbus.Boolean = bool
glib = types.ModuleType("dbus.mainloop.glib")
glib.DBusGMainLoop = Mock()
repository = types.ModuleType("gi.repository")
repository.GLib = Mock()
with patch.dict(sys.modules, {
    "dbus": dbus, "dbus.mainloop": types.ModuleType("dbus.mainloop"),
    "dbus.mainloop.glib": glib, "gi": types.ModuleType("gi"),
    "gi.repository": repository,
}):
    spec = importlib.util.spec_from_file_location("controller_supervisor", Path(__file__).with_name("mango-controller-link.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


class SupervisorTest(unittest.TestCase):
    def setUp(self):
        self.link = module.ControllerLinkSupervisor.__new__(module.ControllerLinkSupervisor)
        self.link.retry = LinkRetryState()
        self.link.retry.paired = True
        self.link.reconnect_mode = "host"
        self.link.next_mode_refresh_at = float("inf")
        self.link.force_repair_requested = False
        self.link.last_status_at = 0
        self.link.last_connected_wall_at = 0
        self.link.last_disconnect_wall_at = 0
        self.link.last_repair_wall_at = 0
        self.link.last_discovery_wall_at = 0
        self.link.repair_count = 0
        self.link.connect_generation = 0
        self.link.active_connect_generation = None
        self.link.connect_cancel_pending = False
        self.link.discovery_active = False
        self.link.device = Mock()
        self.link.device_props = Mock()
        self.link.device_props.Get.return_value = "host"
        self.link.adapter = Mock()
        self.link._adapter_powered = Mock(return_value=True)
        self.link._device_connected = Mock(return_value=False)
        self.link._device_paired = Mock(return_value=True)
        self.link._enforce_adapter_policy = Mock()
        self.link._resolve_device = Mock(return_value=True)
        self.link.write_status = Mock()

    def start(self):
        self.link.retry.next_attempt_at = 0
        self.link._try_connect()
        return self.link.device.Connect.call_args.kwargs

    def test_timeout_holds_ownership_until_disconnect_reply(self):
        callbacks = self.start()
        generation = self.link.active_connect_generation
        self.link._cancel_connect()
        self.assertTrue(self.link.connect_cancel_pending)
        self.link._try_connect()
        self.assertEqual(self.link.device.Connect.call_count, 1)
        callbacks["error_handler"](dbus.DBusException("cancelled"))
        self.assertEqual(self.link.active_connect_generation, generation)
        self.link.device.Disconnect.call_args.kwargs["reply_handler"]()
        self.assertIsNone(self.link.active_connect_generation)
        self.assertFalse(self.link.retry.attempt_in_flight)

    def test_late_old_callbacks_cannot_finish_new_connect(self):
        old = self.start()
        self.link._cancel_connect()
        self.link.device.Disconnect.call_args.kwargs["reply_handler"]()
        self.start()
        generation = self.link.active_connect_generation
        old["error_handler"](dbus.DBusException("old failure"))
        old["reply_handler"]()
        self.assertEqual(self.link.active_connect_generation, generation)
        self.assertTrue(self.link.retry.attempt_in_flight)

    def test_no_reply_cancels_instead_of_starting_overlapping_request(self):
        callbacks = self.start()
        callbacks["error_handler"](dbus.DBusException("org.freedesktop.DBus.Error.NoReply"))
        self.assertTrue(self.link.connect_cancel_pending)
        self.link._try_connect()
        self.assertEqual(self.link.device.Connect.call_count, 1)

    def test_failed_cancellation_does_not_release_ownership(self):
        self.start()
        self.link._cancel_connect()
        self.link.device.Disconnect.call_args.kwargs["error_handler"](dbus.DBusException("NoReply"))
        self.assertIsNotNone(self.link.active_connect_generation)
        self.link._try_connect()
        self.assertEqual(self.link.device.Connect.call_count, 1)

    def test_watchdog_never_disconnects_already_connected_wake(self):
        self.start()
        self.link._device_connected.return_value = True
        self.link._cancel_connect()
        self.link.device.Disconnect.assert_not_called()
        self.assertTrue(self.link.retry.connected)

    def test_local_discovery_signal_is_not_peripheral_wake(self):
        self.link.retry.mark_peripheral_asleep(100)
        self.link._properties_changed("org.bluez.Adapter1", {"Discovering": True}, [])
        self.assertFalse(self.link.retry.wake_detected)
        self.assertTrue(self.link.retry.peripheral_asleep)
        self.link._resolve_device.assert_not_called()

    def test_no_connect_during_discovery(self):
        self.link.discovery_active = True
        self.link._try_connect()
        self.link.device.Connect.assert_not_called()

    def test_exhausted_generic_error_gets_connect_window_after_discovery(self):
        self.link.retry.fast_retry_exhausted = True
        self.link.retry.next_scan_at = 0
        self.link.discovery_active = True
        self.link._stop_discovery()
        self.link._try_connect()
        self.link.adapter.StartDiscovery.assert_not_called()
        self.link.device.Connect.assert_called_once()

    def test_inbound_connected_invalidates_old_callbacks(self):
        callbacks = self.start()
        self.link._properties_changed("org.bluez.Device1", {"Connected": True}, [])
        callbacks["error_handler"](dbus.DBusException("late failure"))
        self.assertTrue(self.link.retry.connected)
        self.assertEqual(self.link.retry.last_error, "")

    def test_confirmed_restart_settles_superseded_flight(self):
        self.start()
        self.link.last_repair_at = -10000
        self.link.repair_count = 0
        with patch.object(module.subprocess, "run", return_value=Mock(returncode=0)):
            self.link._repair_bluez()
        self.assertIsNone(self.link.active_connect_generation)
        self.assertFalse(self.link.retry.attempt_in_flight)

    def test_failed_restart_does_not_release_flight(self):
        self.start()
        self.link.last_repair_at = -10000
        self.link.repair_count = 0
        with patch.object(module.subprocess, "run", return_value=Mock(returncode=1)):
            self.link._repair_bluez()
        self.assertIsNotNone(self.link.active_connect_generation)
        self.assertTrue(self.link.retry.attempt_in_flight)

    def test_late_cancel_reply_cannot_finish_new_flight(self):
        self.start()
        self.link._cancel_connect()
        old_cancel = self.link.device.Disconnect.call_args.kwargs["reply_handler"]
        old_cancel()
        self.start()
        generation = self.link.active_connect_generation
        old_cancel()
        self.assertEqual(self.link.active_connect_generation, generation)
        self.assertTrue(self.link.retry.attempt_in_flight)

    def test_input_readiness_requires_fresh_router_heartbeat(self):
        for updated, expected in ((time.time(), True), (time.time() - 60, False), (float("nan"), False), (None, False)):
            with self.subTest(updated=updated), patch.object(Path, "read_text", return_value=json.dumps({
                "state": "running", "device_path": "/dev/input/event9", "updated_at": updated,
            })):
                self.assertEqual(self.link._input_ready(), expected)

    def test_couch_probe_rejects_already_ready_and_stale_off(self):
        for connected, updated in ((True, time.time()), (False, time.time() - 60)):
            with self.subTest(connected=connected), tempfile.TemporaryDirectory() as folder:
                cache = Path(folder) / "mango"
                cache.mkdir()
                (cache / "mango-controller-link-status.json").write_text(json.dumps({
                    "state": "ready" if connected else "off",
                    "connected": connected, "input_ready": connected, "paired": True,
                    "updated_at": updated, "pairing_policy": "explicit_recovery_only",
                }))
                result = subprocess.run(
                    ["bash", str(Path(__file__).with_name("controller-link-couch-test.sh"))],
                    input="\n", text=True, capture_output=True, timeout=5,
                    env={**os.environ, "XDG_CACHE_HOME": folder, "MANGO_CONTROLLER_TEST_CYCLES": "1"},
                )
                self.assertEqual(result.returncode, 1)
                self.assertIn("fresh disconnected/input-not-ready evidence required", result.stderr)

    def test_passive_modes_never_page_discover_or_cancel_on_ticks(self):
        for mode in ("device", "none", "unknown"):
            with self.subTest(mode=mode):
                self.link.reconnect_mode = mode
                self.link.retry.fast_retry_exhausted = True
                self.link.retry.next_scan_at = 0
                self.link.retry.next_attempt_at = 0
                for _ in range(20):
                    self.link.tick()
                self.link.device.Connect.assert_not_called()
                self.link.device.Disconnect.assert_not_called()
                self.link.adapter.StartDiscovery.assert_not_called()

    def test_host_and_any_modes_keep_host_connect_path(self):
        for mode in ("host", "any"):
            with self.subTest(mode=mode):
                self.link.reconnect_mode = mode
                self.start()["error_handler"](dbus.DBusException("offline"))
        self.assertEqual(self.link.device.Connect.call_count, 2)

    def test_mode_refresh_fails_closed_and_does_not_cache_host_forever(self):
        self.link.device_props.Get.side_effect = dbus.DBusException("UnknownInterface")
        self.link.next_mode_refresh_at = 0
        self.link.tick()
        self.assertEqual(self.link.reconnect_mode, "unknown")
        self.link.device.Connect.assert_not_called()

    def test_input_interface_arrival_rebinds_and_reads_contract(self):
        self.link.reconnect_mode = "unknown"
        self.link._resolve_device = module.ControllerLinkSupervisor._resolve_device.__get__(self.link)
        self.link._bind_device = Mock()
        self.link._device_paired = Mock(return_value=True)
        self.link.device_props.Get.return_value = "device"
        self.link._interfaces_added(module.DEVICE_PATH, {"org.bluez.Input1": {"ReconnectMode": "device"}})
        self.assertEqual(self.link.reconnect_mode, "device")
        self.link.tick()
        self.link.device.Connect.assert_not_called()

    def test_input_interface_removal_invalidates_contract(self):
        self.link._interfaces_removed(module.DEVICE_PATH, ["org.bluez.Input1"])
        self.assertEqual(self.link.reconnect_mode, "unknown")
        self.link._try_connect()
        self.link.device.Connect.assert_not_called()

    def test_changed_contract_during_flight_does_not_cancel_inbound_wake(self):
        callbacks = self.start()
        self.link.device_props.Get.return_value = "device"
        self.link._properties_changed("org.bluez.Input1", {"ReconnectMode": "device"}, [])
        self.link.retry.attempt_started_at = 0
        self.link.tick()
        self.link.device.Disconnect.assert_not_called()
        callbacks["error_handler"](dbus.DBusException("old host attempt failed"))
        self.link.tick()
        self.assertEqual(self.link.device.Connect.call_count, 1)

    def test_passive_retry_request_only_reconciles(self):
        self.link.reconnect_mode = "device"
        self.link.retry.force_retry = Mock()
        self.link.request_retry(0, None)
        self.link._resolve_device.assert_called_once()
        self.link.retry.force_retry.assert_not_called()
        self.link.tick()
        self.link.device.Connect.assert_not_called()

    def test_device_incoming_connection_reaches_real_ready_status(self):
        self.link.reconnect_mode = "device"
        self.link._properties_changed("org.bluez.Device1", {"Connected": True}, [])
        self.link._device_connected.return_value = True
        self.link._device_paired = Mock(return_value=True)
        self.link._input_ready = Mock(return_value=True)
        self.link.last_repair_wall_at = 0
        self.link.last_disconnect_wall_at = 0
        self.link.last_discovery_wall_at = 0
        self.link.repair_count = 0
        with patch.object(module, "write_json") as write:
            module.ControllerLinkSupervisor.write_status(self.link, force=True)
        payload = write.call_args.args[1]
        self.assertEqual(payload["state"], "ready")
        self.assertTrue(payload["input_ready"])
        self.assertEqual(payload["reconnect_owner"], "device")
        self.assertIsNone(payload["next_attempt_at"])
        self.link.device.Connect.assert_not_called()

    def test_bluez_restart_invalidates_old_flight_and_rebinds_adapter(self):
        callbacks = self.start()
        self.link._bind_adapter = Mock()
        self.link._bluez_owner_changed("org.bluez", ":1.old", ":1.new")
        self.assertEqual(self.link.reconnect_mode, "unknown")
        self.assertIsNone(self.link.active_connect_generation)
        self.link._bind_adapter.assert_called_once()
        self.link._resolve_device.assert_called_once()
        callbacks["error_handler"](dbus.DBusException("old daemon error"))
        self.assertFalse(self.link.retry.attempt_in_flight)

    def test_input_mode_invalidation_is_read_again(self):
        self.link.device_props.Get.return_value = "device"
        self.link._properties_changed("org.bluez.Input1", {}, ["ReconnectMode"])
        self.assertEqual(self.link.reconnect_mode, "device")

    def test_rebind_to_device_mode_cannot_fall_through_to_connect(self):
        self.link.retry.device_present = False
        self.link._maybe_discover_known_device = Mock()
        def rebind():
            self.link.retry.device_present = True
            self.link.reconnect_mode = "device"
            return True
        self.link._resolve_device.side_effect = rebind
        self.link._try_connect()
        self.link.device.Connect.assert_not_called()

    def test_device_mode_blocks_direct_discovery_and_cancel_helpers(self):
        self.link.reconnect_mode = "device"
        self.link.retry.fast_retry_exhausted = True
        self.link.active_connect_generation = 12
        self.link._maybe_discover_known_device()
        self.link._cancel_connect()
        self.link.adapter.StartDiscovery.assert_not_called()
        self.link.device.Disconnect.assert_not_called()

    def test_mode_signal_during_adapter_read_prevents_connect(self):
        def adapter_policy():
            self.link.reconnect_mode = "device"
        self.link._enforce_adapter_policy.side_effect = adapter_policy
        self.link._try_connect()
        self.link.device.Connect.assert_not_called()

    def test_real_initialization_reads_device_contract_before_first_tick(self):
        bus = Mock()
        bus.get_object.side_effect = lambda _service, path: path
        adapter = Mock()
        device = Mock()
        adapter_props = Mock()
        adapter_props.Get.side_effect = lambda _interface, key: key == "Powered"
        device_props = Mock()
        values = {"Paired": True, "Connected": False, "ReconnectMode": "device"}
        device_props.Get.side_effect = lambda _interface, key: values[key]
        def interface(path, name):
            if name == "org.freedesktop.DBus.Properties":
                return adapter_props if path == module.ADAPTER_PATH else device_props
            return adapter if name == "org.bluez.Adapter1" else device
        with patch.object(dbus, "SystemBus", return_value=bus, create=True), \
             patch.object(dbus, "Interface", side_effect=interface, create=True), \
             patch.object(module, "write_json") as write:
            link = module.ControllerLinkSupervisor()
            for _ in range(8):
                link.tick()
        self.assertEqual(link.reconnect_mode, "device")
        device.Connect.assert_not_called()
        device.Disconnect.assert_not_called()
        adapter.StartDiscovery.assert_not_called()
        payload = write.call_args.args[1]
        self.assertEqual(payload["state"], "off")
        self.assertEqual(payload["retry_phase"], "awaiting_peripheral")
        self.assertIsNone(payload["next_attempt_at"])

    def status_payload(self):
        self.link._input_ready = Mock(return_value=False)
        with patch.object(module, "write_json") as write:
            module.ControllerLinkSupervisor.write_status(self.link, force=True)
        return write.call_args.args[1]

    def test_unknown_contract_is_not_healthy_but_device_off_is(self):
        self.link.reconnect_mode = "unknown"
        payload = self.status_payload()
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["last_error"], "reconnect_mode_unknown")
        self.link.reconnect_mode = "device"
        self.assertTrue(self.status_payload()["ok"])

    def test_old_host_flight_past_deadline_in_passive_is_unhealthy_not_cancelled(self):
        self.start()
        self.link.reconnect_mode = "device"
        self.link.retry.attempt_started_at = time.monotonic() - 30
        self.link.tick()
        payload = self.status_payload()
        self.assertFalse(payload["ok"])
        self.assertTrue(payload["connect_outcome_unknown"])
        self.assertEqual(payload["retry_phase"], "awaiting_previous_host_connect")
        self.link.device.Disconnect.assert_not_called()
        self.assertIsNotNone(self.link.active_connect_generation)

    def test_passive_noreply_keeps_ownership_and_reports_unknown_outcome(self):
        callbacks = self.start()
        self.link.reconnect_mode = "device"
        callbacks["error_handler"](dbus.DBusException("org.freedesktop.DBus.Error.NoReply"))
        self.assertFalse(self.status_payload()["ok"])
        self.link.device.Disconnect.assert_not_called()
        generation = self.link.active_connect_generation
        self.link.reconnect_mode = "host"
        self.link._try_connect()
        self.assertEqual(self.link.active_connect_generation, generation)
        self.assertEqual(self.link.device.Connect.call_count, 1)


if __name__ == "__main__":
    unittest.main()
