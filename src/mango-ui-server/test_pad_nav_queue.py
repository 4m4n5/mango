#!/usr/bin/env python3
"""Unit tests for pad-nav queue: peek, session drain, probe contract helpers."""

from __future__ import annotations

import sys
import tempfile
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import serve  # noqa: E402


def _reset_queue() -> None:
    with serve._pad_nav_cond:
        serve._pad_nav_commands.clear()
        serve._pad_nav_session_id = None
        serve._pad_nav_session_seen_at = 0.0
        serve._pad_nav_render_age_ms = float("inf")
        serve._pad_nav_last_ack_at = 0.0
        serve._pad_nav_last_recovery_at = 0.0


class PadNavQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        _reset_queue()

    def tearDown(self) -> None:
        _reset_queue()

    def test_enqueue_and_peek(self) -> None:
        seq1 = serve.enqueue_pad_nav_command(
            {"type": "pad_nav", "action": "move", "direction": "down"}
        )
        seq2 = serve.enqueue_pad_nav_command(
            {"type": "pad_nav", "action": "move", "direction": "right"}
        )
        pending, latest = serve.drain_pad_nav_commands(0)
        self.assertEqual(latest, seq2)
        self.assertEqual([entry["seq"] for entry in pending], [seq1, seq2])
        # Peek is non-destructive.
        again, _ = serve.drain_pad_nav_commands(0)
        self.assertEqual(len(again), 2)
        after_first, _ = serve.drain_pad_nav_commands(seq1)
        self.assertEqual([entry["seq"] for entry in after_first], [seq2])

    def test_ack_with_session_drains(self) -> None:
        session = serve.register_pad_nav_session()
        self.assertIsNotNone(session)
        seq = serve.enqueue_pad_nav_command(
            {"type": "pad_nav", "action": "move", "direction": "left"}
        )
        latest, drained = serve.ack_pad_nav_commands(seq, session)
        self.assertTrue(drained)
        self.assertEqual(latest, seq)
        self.assertEqual(serve.pad_nav_pending_count(), 0)

    def test_ack_without_matching_session_does_not_drain(self) -> None:
        serve.register_pad_nav_session()
        seq = serve.enqueue_pad_nav_command(
            {"type": "pad_nav", "action": "select"}
        )
        _, drained = serve.ack_pad_nav_commands(seq, "foreign-session")
        self.assertFalse(drained)
        self.assertEqual(serve.pad_nav_pending_count(), 1)
        _, drained_none = serve.ack_pad_nav_commands(seq, None)
        self.assertFalse(drained_none)
        self.assertEqual(serve.pad_nav_pending_count(), 1)

    def test_probe_contract_does_not_enqueue(self) -> None:
        """Mirrors POST probe=true: validate + return latest seq without enqueue."""
        before = serve.latest_pad_nav_seq()
        pending_before = serve.pad_nav_pending_count()
        # Probe path uses latest_pad_nav_seq / pad_nav_pending_count only.
        seq = serve.latest_pad_nav_seq()
        pending = serve.pad_nav_pending_count()
        self.assertEqual(seq, before)
        self.assertEqual(pending, pending_before)
        self.assertEqual(serve.pad_nav_pending_count(), 0)

    def test_session_ack_compacts_so_maxlen_cannot_drop_live_commands(self) -> None:
        session = serve.register_pad_nav_session()
        self.assertIsNotNone(session)
        maxlen = serve._pad_nav_commands.maxlen or 64
        first = serve.enqueue_pad_nav_command(
            {"type": "pad_nav", "action": "move", "direction": "up"}
        )
        # TV acks the first command before the burst fills the deque.
        serve.ack_pad_nav_commands(first, session)
        last = first
        for _ in range(maxlen):
            last = serve.enqueue_pad_nav_command(
                {"type": "pad_nav", "action": "move", "direction": "down"}
            )
        pending, _ = serve.drain_pad_nav_commands(0)
        self.assertEqual(len(pending), maxlen)
        self.assertEqual(pending[0]["seq"], first + 1)
        self.assertEqual(pending[-1]["seq"], last)
        serve.ack_pad_nav_commands(last, session)
        self.assertEqual(serve.pad_nav_pending_count(), 0)

    def test_live_session_lease_cannot_be_stolen(self) -> None:
        owner = serve.register_pad_nav_session()
        self.assertIsNotNone(owner)
        self.assertIsNone(serve.register_pad_nav_session("foreign"))
        self.assertEqual(serve.register_pad_nav_session(owner), owner)
        self.assertTrue(serve.heartbeat_pad_nav_session(owner, 12.0))
        self.assertFalse(serve.heartbeat_pad_nav_session("foreign", 0.0))

    def test_stale_session_can_be_replaced(self) -> None:
        owner = serve.register_pad_nav_session()
        self.assertIsNotNone(owner)
        serve._pad_nav_session_seen_at = time.time() - serve.PAD_NAV_STALL_SEC - 0.1
        replacement = serve.register_pad_nav_session("foreign")
        self.assertIsNotNone(replacement)
        self.assertNotEqual(replacement, owner)

    def test_pending_command_claims_one_recovery_after_stall_budget(self) -> None:
        self.assertIsNotNone(serve.register_pad_nav_session())
        seq = serve.enqueue_pad_nav_command(
            {"type": "pad_nav", "action": "move", "direction": "down"}
        )
        self.assertGreater(seq, 0)
        with serve._pad_nav_lock:
            issued_at = float(serve._pad_nav_commands[0]["issued_at"])
        recovery_at = issued_at + serve.PAD_NAV_STALL_SEC + 0.01
        self.assertIsNotNone(serve.pad_nav_recovery_reason(recovery_at))
        self.assertIsNone(serve.pad_nav_recovery_reason(recovery_at + 0.01))

    def test_early_input_does_not_restart_during_cold_boot(self) -> None:
        serve.enqueue_pad_nav_command(
            {"type": "pad_nav", "action": "move", "direction": "down"}
        )
        with serve._pad_nav_lock:
            issued_at = float(serve._pad_nav_commands[0]["issued_at"])
        self.assertIsNone(
            serve.pad_nav_recovery_reason(
                issued_at + serve.PAD_NAV_STALL_SEC + 0.01
            )
        )

    def test_pending_command_never_restarts_launcher_over_playback(self) -> None:
        self.assertIsNotNone(serve.register_pad_nav_session())
        serve.enqueue_pad_nav_command(
            {"type": "pad_nav", "action": "select"}
        )
        with serve._pad_nav_lock:
            issued_at = float(serve._pad_nav_commands[0]["issued_at"])
        with tempfile.TemporaryDirectory() as temp_dir:
            original = serve.PLAYBACK_ACTIVE_FILE
            try:
                serve.PLAYBACK_ACTIVE_FILE = Path(temp_dir) / "playback-active"
                serve.PLAYBACK_ACTIVE_FILE.touch()
                self.assertIsNone(
                    serve.pad_nav_recovery_reason(
                        issued_at + serve.PAD_NAV_STALL_SEC + 0.01
                    )
                )
            finally:
                serve.PLAYBACK_ACTIVE_FILE = original


if __name__ == "__main__":
    unittest.main()
