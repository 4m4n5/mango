#!/usr/bin/env python3
"""Focused tests for the AREA69 curated M3U/search-index builder."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-curated-area69-m3u.py")
SPEC = importlib.util.spec_from_file_location("build_curated_area69_m3u", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
AREA69 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AREA69)


class Area69SearchIndexTests(unittest.TestCase):
    def test_retains_match_rows_but_excludes_unavailable_and_vod_rows(self) -> None:
        rows = [
            {
                "stream_id": 1,
                "name": "US: FIFA World Cup: India VS England (2026-07-16 19:00)",
                "category_id": 91,
            },
            {"stream_id": 2, "name": "India v Australia @ Thu Jul 16 10:00 AM"},
            {"stream_id": 3, "name": "Willow Cricket HD"},
            {"stream_id": 4, "name": "India VS England REPLAY"},
            {"stream_id": 5, "name": "FIFA Final EVENT ENDED"},
            {"stream_id": 6, "name": "NO EVENT STREAMING"},
            {"stream_id": 7, "name": "PPV 123"},
            {"stream_id": 8, "name": "The Office S01E01 1080p"},
            {"stream_id": 9, "name": "Complete Season 1"},
            {"stream_id": 10, "name": "MOVIE: The Martian"},
        ]

        entries = AREA69.build_search_index(rows)

        self.assertEqual([entry["stream_id"] for entry in entries], ["1", "2", "3"])
        self.assertEqual(entries[0]["kind"], "event")
        self.assertEqual(entries[1]["kind"], "event")
        self.assertEqual(entries[2]["kind"], "channel")

    def test_retains_safe_context_without_persisting_provider_source(self) -> None:
        entries = AREA69.build_search_index([{
            "stream_id": "7001",
            "name": "India VS England 1st Test 2026-07-16",
            "category_id": "42",
            "category_name": "India Cricket",
            "stream_icon": "https://img.example/india.png",
            "epg_channel_id": "india.cricket",
            "event_start": 1784247600,
            "competition": "Test Cricket",
            "direct_source": "https://example.test/live/alice/super-secret/7001.ts",
        }])

        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry["category_id"], "42")
        self.assertEqual(entry["category"], "India Cricket")
        self.assertEqual(entry["logo"], "https://img.example/india.png")
        self.assertEqual(entry["epg_channel_id"], "india.cricket")
        self.assertEqual(entry["event"]["starts_at"], 1784247600)
        self.assertEqual(entry["event"]["competition"], "Test Cricket")
        self.assertNotIn("direct_source", entry)
        self.assertNotIn("super-secret", repr(entry))

    def test_compact_m3u_still_rejects_transient_event_rows(self) -> None:
        picked = AREA69.pick_streams([
            {"stream_id": 1, "name": "FIFA World Cup: France VS Brazil 2026-07-17"},
            {"stream_id": 2, "name": "FIFA TV"},
        ])

        self.assertEqual([stream_id for _, stream_id, *_ in picked], ["2"])

    def test_credential_bearing_logo_url_is_not_persisted(self) -> None:
        entries = AREA69.build_search_index([{
            "stream_id": 1,
            "name": "Willow Cricket HD",
            "stream_icon": "https://alice:super-secret@img.example/logo.png",
        }])
        self.assertNotIn("logo", entries[0])
        self.assertNotIn("super-secret", repr(entries))


if __name__ == "__main__":
    unittest.main()
