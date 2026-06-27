"""Tests for Saved-library voice tool routing helpers."""

from __future__ import annotations

import unittest

from orchestrator.tools.launcher import build_launcher_command
from orchestrator.tools.runner import tool_summary


class LibraryToolSummaryTests(unittest.TestCase):
    def test_save_unsave_summaries_do_not_claim_playback(self) -> None:
        self.assertEqual(tool_summary("mango_save_title", {"current": True}), "Saving current title")
        self.assertEqual(
            tool_summary("mango_unsave_title", {"title": "Heat"}),
            "Removing Heat from Saved",
        )
        self.assertNotIn("play", tool_summary("mango_save_title", {"title": "Heat"}).lower())

    def test_youtube_summaries_do_not_claim_playback(self) -> None:
        self.assertEqual(
            tool_summary("mango_youtube_search", {"query": "lofi live"}),
            "Searching YouTube for lofi live",
        )
        self.assertEqual(
            tool_summary("mango_open_youtube", {"title": "Lofi Girl"}),
            "Opening YouTube Lofi Girl",
        )
        self.assertNotIn("play", tool_summary("mango_open_youtube", {"title": "Lofi Girl"}).lower())

    def test_open_youtube_command_targets_youtube_tab(self) -> None:
        command = build_launcher_command(
            "mango_open_youtube",
            {
                "type": "youtube_video",
                "id": "AbC_123-XyZ",
                "title": "A Video",
                "poster": "https://example.test/thumb.jpg",
            },
        )
        self.assertEqual(command["action"], "open_detail")
        self.assertEqual(command["content_type"], "youtube_video")
        self.assertEqual(command["source"], "youtube")
        self.assertEqual(command["tab"], "youtube")


if __name__ == "__main__":
    unittest.main()
