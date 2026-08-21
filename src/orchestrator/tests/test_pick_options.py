"""Tests for companion structured search picks."""

from __future__ import annotations

import json
import unittest

from orchestrator.pick_options import (
    enrich_tool_event,
    pick_hit_at_index,
    pick_options_from_result,
    tool_result_open_confirmed,
)


class PickOptionsTests(unittest.TestCase):
    def test_pick_options_from_two_to_four_hits(self) -> None:
        payload = {
            "ok": True,
            "results": [
                {"type": "movie", "id": "tt1", "title": "Alpha", "tab": "movies", "year": "2020"},
                {"type": "movie", "id": "tt2", "title": "Beta", "tab": "movies"},
                {"type": "tv", "id": "ch1", "title": "Cartoon Channel", "tab": "live"},
            ],
        }
        options = pick_options_from_result(json.dumps(payload))
        self.assertEqual(len(options), 3)
        self.assertEqual(options[0]["n"], 1)
        self.assertEqual(options[0]["title"], "Alpha")
        self.assertEqual(options[0]["year"], "2020")
        self.assertEqual(options[2]["tab"], "live")

    def test_enrich_skips_single_hit(self) -> None:
        payload = {"ok": True, "results": [{"type": "movie", "id": "tt1", "title": "Only One"}]}
        event = enrich_tool_event(
            {
                "type": "tool",
                "phase": "done",
                "name": "mango_search",
                "summary": "Searching",
                "result": json.dumps(payload),
            }
        )
        self.assertNotIn("options", event)

    def test_enrich_adds_options_for_ambiguous_search(self) -> None:
        payload = {
            "ok": True,
            "results": [
                {"type": "movie", "id": "tt1", "title": "One"},
                {"type": "movie", "id": "tt2", "title": "Two"},
            ],
        }
        event = enrich_tool_event(
            {
                "type": "tool",
                "phase": "done",
                "name": "mango_search",
                "summary": "Searching",
                "result": json.dumps(payload),
            }
        )
        self.assertEqual(len(event["options"]), 2)

    def test_pick_hit_at_index(self) -> None:
        hits = [{"title": "A"}, {"title": "B"}]
        self.assertEqual(pick_hit_at_index(hits, 2)["title"], "B")
        self.assertIsNone(pick_hit_at_index(hits, 3))

    def test_tool_result_open_confirmed(self) -> None:
        ok = json.dumps({"ok": True, "tv_seq": 42})
        bad = json.dumps({"ok": False})
        self.assertTrue(tool_result_open_confirmed(ok))
        self.assertFalse(tool_result_open_confirmed(bad))


if __name__ == "__main__":
    unittest.main()
