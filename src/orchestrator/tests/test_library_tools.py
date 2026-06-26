"""Tests for Saved-library voice tool routing helpers."""

from __future__ import annotations

import unittest

from orchestrator.tools.runner import tool_summary


class LibraryToolSummaryTests(unittest.TestCase):
    def test_save_unsave_summaries_do_not_claim_playback(self) -> None:
        self.assertEqual(tool_summary("mango_save_title", {"current": True}), "Saving current title")
        self.assertEqual(
            tool_summary("mango_unsave_title", {"title": "Heat"}),
            "Removing Heat from Saved",
        )
        self.assertNotIn("play", tool_summary("mango_save_title", {"title": "Heat"}).lower())


if __name__ == "__main__":
    unittest.main()

