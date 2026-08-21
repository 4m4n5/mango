"""Tests for the per-turn TV CONTEXT system-prompt block."""

from __future__ import annotations

import unittest

from orchestrator.llm.agent import _format_tv_context_block
from orchestrator.session import SessionState


class TvContextBlockTests(unittest.TestCase):
    def test_nothing_playing_and_no_tv_state(self) -> None:
        payload = {
            "ok": True,
            "now_playing": {"ok": True, "active": False},
            "ai_rails_by_tab": {"movies": [], "series": [], "live": [], "youtube": []},
        }
        block = _format_tv_context_block(payload, None)
        self.assertEqual(block, "TV CONTEXT: nothing playing")

    def test_full_context_includes_playback_tab_and_rails(self) -> None:
        payload = {
            "ok": True,
            "now_playing": {"ok": True, "active": True, "title": "Panchayat", "progress_pct": 42},
            "ai_rails_by_tab": {
                "movies": [{"slot_id": "a", "rail_id": "ai_catalog:a", "label": "Cozy Nights", "content_type": "movie"}],
                "series": [{"slot_id": "b", "rail_id": "ai_catalog:b", "label": "Weeknight Comedy", "content_type": "series"}],
                "live": [],
                "youtube": [],
            },
        }
        block = _format_tv_context_block(payload, {"last_nav_tab": "movies", "last_open": None})
        self.assertEqual(
            block,
            'TV CONTEXT: now playing "Panchayat" (42%) | current tab: movies | '
            "active AI rails: movies[Cozy Nights], series[Weeknight Comedy]",
        )

    def test_invalid_payload_yields_no_block(self) -> None:
        self.assertIsNone(_format_tv_context_block(None, None))
        self.assertIsNone(_format_tv_context_block({"ok": False}, None))


class SessionRecordDispatchedCommandTests(unittest.TestCase):
    def test_tab_navigation_updates_last_nav_tab(self) -> None:
        session = SessionState()
        session.record_dispatched_command({"type": "launcher_command", "action": "tab", "tab": "series"})
        self.assertEqual(session.last_nav_tab, "series")
        self.assertIsNone(session.last_open)

    def test_open_detail_updates_last_open_and_tab(self) -> None:
        session = SessionState()
        session.record_dispatched_command(
            {
                "type": "launcher_command",
                "action": "open_detail",
                "content_type": "movie",
                "id": "tt123",
                "title": "Panchayat",
                "tab": "movies",
            }
        )
        self.assertEqual(session.last_nav_tab, "movies")
        self.assertEqual(
            session.last_open,
            {"title": "Panchayat", "type": "movie", "tab": "movies"},
        )

    def test_home_action_does_not_touch_state(self) -> None:
        session = SessionState()
        session.record_dispatched_command({"type": "launcher_command", "action": "home"})
        self.assertIsNone(session.last_nav_tab)
        self.assertIsNone(session.last_open)


if __name__ == "__main__":
    unittest.main()
