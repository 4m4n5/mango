#!/usr/bin/env python3
"""Unit tests for the dependency-free controller retry policy."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

MODULE = Path(__file__).with_name("controller-link-state.py")
SPEC = importlib.util.spec_from_file_location("controller_link_state", MODULE)
assert SPEC and SPEC.loader
STATE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = STATE
SPEC.loader.exec_module(STATE)


class ControllerLinkStateTest(unittest.TestCase):
    def test_disconnect_uses_fast_then_maintenance_backoff(self) -> None:
        state = STATE.LinkRetryState()
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
        self.assertEqual(state.phase, "maintenance_retry")

    def test_connected_cancels_pending_retries(self) -> None:
        state = STATE.LinkRetryState()
        state.mark_disconnected(10.0)
        state.begin_attempt(10.0)
        state.mark_connected(11.0)
        self.assertTrue(state.connected)
        self.assertFalse(state.attempt_in_flight)
        self.assertFalse(state.due(99.0))
        self.assertEqual(state.phase, "ready")

    def test_force_retry_does_not_interrupt_a_ready_link(self) -> None:
        state = STATE.LinkRetryState()
        state.mark_connected(10.0)
        state.force_retry(11.0)
        self.assertFalse(state.due(11.0))
        state.mark_disconnected(12.0)
        state.force_retry(20.0)
        self.assertTrue(state.due(20.0))

    def test_policy_allows_a_safe_maintenance_override(self) -> None:
        state = STATE.LinkRetryState(fast_retry_delays_sec=(0.0, 0.5), maintenance_retry_sec=3.0)
        state.mark_disconnected(0.0)
        state.begin_attempt(0.0)
        state.complete_attempt(0.0, "offline")
        state.begin_attempt(0.5)
        state.complete_attempt(0.5, "offline")
        self.assertEqual(state.next_attempt_at, 3.5)


if __name__ == "__main__":
    unittest.main()
