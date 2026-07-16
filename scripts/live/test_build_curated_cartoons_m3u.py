#!/usr/bin/env python3
"""Focused tests for the language-qualified cartoons playlist builder."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-curated-cartoons-m3u.py")
SPEC = importlib.util.spec_from_file_location("build_curated_cartoons_m3u", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
CARTOONS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CARTOONS)


def block(name: str, channel_id: str, number: int, extra: str = "") -> tuple[str, str]:
    return name, "\n".join([
        f'#EXTINF:-1 tvg-id="{channel_id}" group-title="Kids"{extra},{name}',
        f"https://stream.example/{number}.m3u8",
    ])


class CartoonPlaylistTests(unittest.TestCase):
    def test_language_evidence_is_strict_and_canonical(self) -> None:
        self.assertEqual(CARTOONS.approved_language_labels(("eng", "hin")), ("English", "Hindi"))
        self.assertEqual(CARTOONS.approved_language_labels(("English",)), ("English",))
        self.assertEqual(CARTOONS.approved_language_labels(()), ())
        self.assertEqual(CARTOONS.approved_language_labels(("eng", "spa")), ())

    def test_selects_at_most_eight_eligible_families_in_classics_first_order(self) -> None:
        blocks = [
            block("Tom And Jerry", "TomAndJerry.us@HD", 1),
            block("Nickelodeon Pluto TV", "NickelodeonPlutoTV.us@SD", 2),
            block("NickToons", "Nicktoons.us@FAST", 3),
            block("Nick Jr.", "NickJr.us@East", 4),
            block("PBS Kids Eastern/Central", "PBSKidsEasternCentral.us@SD", 5),
            block("HappyKids", "HappyKids.us@SD", 6),
            block("Kartoon Channel", "KartoonChannel.us@SD", 7),
            block("Moonbug Kids", "MoonbugKids.uk@SD", 8),
        ]
        languages = {
            channel_id.split("@", 1)[0]: ("eng",)
            for _, raw in blocks
            for channel_id in [CARTOONS.extinf_attribute(raw, "tvg-id")]
        }

        selected, missing = CARTOONS.select_blocks(blocks, languages)

        self.assertEqual(len(selected), CARTOONS.MAX_FAMILIES)
        self.assertEqual(missing, [])
        self.assertIn(",Tom And Jerry", selected[0])
        self.assertIn(",Moonbug Kids", selected[-1])
        self.assertTrue(all('tvg-language="English"' in item for item in selected))

    def test_rejects_unknown_foreign_and_known_localized_variants(self) -> None:
        blocks = [
            block("Tom And Jerry", "TomAndJerry.us@Brazil", 1),
            block("Tom And Jerry", "TomAndJerry.us@HD", 2),
            block("NickToons", "Nicktoons.bg@SD", 3),
            block("Moonbug Kids", "MoonbugKids.uk@SD", 4),
        ]
        languages = {
            "TomAndJerry.us": ("eng",),
            "Nicktoons.bg": ("bul",),
            # Moonbug intentionally has no source-language metadata.
        }

        selected, _ = CARTOONS.select_blocks(blocks, languages)

        self.assertEqual(len(selected), 1)
        self.assertIn("https://stream.example/2.m3u8", selected[0])
        self.assertNotIn("Brazil", selected[0])

    def test_checked_in_playlist_has_explicit_approved_language_evidence(self) -> None:
        playlist = (CARTOONS.REPO / "config" / "live-cartoons.m3u").read_text(encoding="utf-8")
        extinf = [line for line in playlist.splitlines() if line.startswith("#EXTINF")]
        self.assertGreater(len(extinf), 0)
        self.assertLessEqual(len(extinf), CARTOONS.MAX_FAMILIES)
        for line in extinf:
            language = CARTOONS.extinf_attribute(line, "tvg-language")
            self.assertIn(language, ("English", "Hindi", "English;Hindi"), line)


if __name__ == "__main__":
    unittest.main()
