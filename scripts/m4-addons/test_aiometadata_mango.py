#!/usr/bin/env python3
"""Focused tests for Mango's AIOMetadata configuration policy."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

from aiometadata_mango import apply_self_host_api_keys, normalize_metadata_providers


class AIOMetadataProviderPolicyTest(unittest.TestCase):
    def test_tvdb_without_key_uses_tvmaze_for_series(self) -> None:
        source = {"movie": "tmdb", "series": "tvdb", "anime": "mal"}

        actual = normalize_metadata_providers(source, {"tmdb": "configured"})

        self.assertEqual(actual["series"], "tvmaze")
        self.assertEqual(source["series"], "tvdb")

    def test_explicit_tvdb_key_preserves_tvdb(self) -> None:
        actual = normalize_metadata_providers(
            {"movie": "tmdb", "series": "tvdb"},
            {"tvdb": "configured"},
        )

        self.assertEqual(actual["series"], "tvdb")

    def test_non_tvdb_series_provider_is_unchanged(self) -> None:
        actual = normalize_metadata_providers(
            {"movie": "tmdb", "series": "tmdb"},
            {},
        )

        self.assertEqual(actual["series"], "tmdb")

    def test_tvdb_key_can_come_from_self_host_environment(self) -> None:
        api_keys: dict[str, object] = {}

        apply_self_host_api_keys(api_keys, {"TVDB_API_KEY": " from-env "})

        self.assertEqual(api_keys["tvdb"], "from-env")
        self.assertFalse(api_keys["hasBuiltInTvdb"])


if __name__ == "__main__":
    unittest.main()
