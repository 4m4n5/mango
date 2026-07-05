"""Tests for human tool summaries shown on phone/HUD."""

from __future__ import annotations

import unittest

from orchestrator.tools.runner import tool_summary


class ToolSummaryTests(unittest.TestCase):
    def test_mango_search_uses_mango_not_library_only(self) -> None:
        summary = tool_summary("mango_search", {"query": "cartoon channel"})
        self.assertIn("cartoon channel", summary)
        self.assertNotIn("library for", summary.lower())
        self.assertIn("mango", summary.lower())


if __name__ == "__main__":
    unittest.main()
