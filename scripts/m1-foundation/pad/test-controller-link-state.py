#!/usr/bin/env python3
"""Unit tests for the dependency-free controller retry policy."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

MODULE = Path(__file__).with_name("controller_link_state.py")
SPEC = importlib.util.spec_from_file_location("controller_link_state", MODULE)
assert SPEC and SPEC.loader
STATE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = STATE
SPEC.loader.exec_module(STATE)


class ControllerLinkStateTest(unittest.TestCase):
    def test_disconnect_uses_fast_then_maintenance_backoff(self) -> None:
        state = STATE.LinkRetryState(disconnect_grace_sec=0.0)
        state.mark_disconnected(100.0)
        self.assertTrue(state.due(100.0))
        state.begin_attempt(100.0)
        self.assertFalse(state.due(100.0))
        state.complete_attempt(100.0, "offline")
        self.assertEqual(state.next_attempt_at, 101.0)
        for expected in (103.0, 107.0, 115.0):
            state.begin_attempt(state.next_attempt_at)
            state.complete_attempt(state.next_attempt_at, "offline")
            self.assertEqual(state.next_attempt_at, expected)
        state.begin_attempt(115.0)
        state.complete_attempt(115.0, "offline")
        self.assertEqual(state.next_attempt_at, 120.0)
        self.assertEqual(state.retry_phase, "maintenance_retry")
        self.assertEqual(state.couch_state(adapter_ready=True, input_ready=False), "off")

    def test_connected_cancels_pending_retries(self) -> None:
        state = STATE.LinkRetryState()
        state.mark_disconnected(10.0)
        state.begin_attempt(10.0)
        state.mark_connected(11.0)
        self.assertTrue(state.connected)
        self.assertFalse(state.attempt_in_flight)
        self.assertFalse(state.due(99.0))
        self.assertEqual(state.retry_phase, "ready")
        self.assertEqual(state.couch_state(adapter_ready=True, input_ready=True), "ready")

    def test_force_retry_does_not_interrupt_a_ready_link(self) -> None:
        state = STATE.LinkRetryState()
        state.mark_connected(10.0)
        state.force_retry(11.0)
        self.assertFalse(state.due(11.0))
        state.mark_disconnected(12.0)
        state.force_retry(20.0)
        self.assertTrue(state.due(20.0))

    def test_policy_allows_a_safe_maintenance_override(self) -> None:
        state = STATE.LinkRetryState(
            fast_retry_delays_sec=(0.0, 0.5),
            maintenance_retry_sec=3.0,
            disconnect_grace_sec=0.0,
        )
        state.mark_disconnected(0.0)
        state.begin_attempt(0.0)
        state.complete_attempt(0.0, "offline")
        state.begin_attempt(0.5)
        state.complete_attempt(0.5, "offline")
        self.assertEqual(state.next_attempt_at, 3.5)

    def test_missing_device_object_recovers_without_claiming_pairing_loss(self) -> None:
        state = STATE.LinkRetryState(fast_retry_delays_sec=(0.0, 1.0), maintenance_retry_sec=5.0)
        state.mark_disconnected(10.0)
        state.begin_attempt(10.0)
        state.mark_device_missing(10.5, "UnknownObject")
        self.assertFalse(state.device_present)
        self.assertIsNone(state.paired)
        self.assertFalse(state.needs_re_pair)
        self.assertEqual(state.couch_state(adapter_ready=True, input_ready=False), "connecting")

        state.mark_device_resolved(11.5, paired=True)
        self.assertTrue(state.device_present)
        self.assertTrue(state.paired)
        self.assertTrue(state.due(11.5))

    def test_only_confirmed_missing_bond_requires_re_pair(self) -> None:
        state = STATE.LinkRetryState()
        state.mark_disconnected(20.0)
        state.mark_device_resolved(20.0, paired=False)
        self.assertTrue(state.needs_re_pair)
        self.assertEqual(state.couch_state(adapter_ready=True, input_ready=False), "needs_re-pair")

        state.mark_device_missing(21.0)
        self.assertFalse(state.needs_re_pair)
        self.assertEqual(state.couch_state(adapter_ready=True, input_ready=False), "connecting")

    def test_connected_without_evdev_has_distinct_public_state(self) -> None:
        state = STATE.LinkRetryState()
        state.mark_connected(30.0)
        self.assertEqual(
            state.couch_state(adapter_ready=True, input_ready=False),
            "connected_waiting_for_input",
        )

    def test_host_is_down_suppresses_connect_until_wake_evidence(self) -> None:
        state = STATE.LinkRetryState(
            fast_retry_delays_sec=(0.0, 1.0, 2.0),
            maintenance_retry_sec=5.0,
            asleep_scan_sec=15.0,
            disconnect_grace_sec=0.0,
        )
        state.mark_disconnected(50.0)
        state.begin_attempt(50.0)
        state.complete_attempt(50.0, "org.bluez.Error.Failed: Host is down (112)")
        self.assertTrue(state.peripheral_asleep)
        self.assertFalse(state.wake_detected)
        self.assertFalse(state.due(70.0))
        self.assertTrue(state.scan_due(65.0))
        self.assertEqual(state.retry_phase, "awaiting_peripheral")
        self.assertEqual(state.couch_state(adapter_ready=True, input_ready=False), "off")

        state.mark_wake_detected(80.0)
        self.assertFalse(state.peripheral_asleep)
        self.assertTrue(state.wake_detected)
        self.assertTrue(state.due(80.0))
        self.assertEqual(state.retry_phase, "fast_retry")

    def test_page_timeout_without_wake_also_awaits_peripheral(self) -> None:
        state = STATE.LinkRetryState(disconnect_grace_sec=0.0)
        state.mark_disconnected(10.0)
        state.begin_attempt(10.0)
        state.complete_attempt(10.0, "Connection timed out (110)")
        self.assertTrue(state.peripheral_asleep)
        self.assertFalse(state.due(20.0))
        self.assertTrue(STATE.is_peripheral_asleep_error("Host is down (112)"))
        self.assertTrue(STATE.is_pageable_timeout_error("Connection timed out (110)"))


if __name__ == "__main__":
    unittest.main()
