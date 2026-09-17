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
        self.link.connect_generation = 0
        self.link.active_connect_generation = None
        self.link.connect_cancel_pending = False
        self.link.discovery_active = False
        self.link.device = Mock()
        self.link.adapter = Mock()
        self.link._adapter_powered = Mock(return_value=True)
        self.link._device_connected = Mock(return_value=False)
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


if __name__ == "__main__":
    unittest.main()
