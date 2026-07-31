#!/usr/bin/env python3
"""Unit tests for pad-nav queue: peek, session drain, probe contract helpers."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import serve  # noqa: E402


def _reset_queue() -> None:
    with serve._pad_nav_cond:
        serve._pad_nav_commands.clear()
        serve._pad_nav_session_id = None


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


if __name__ == "__main__":
    unittest.main()
