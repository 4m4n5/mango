#!/usr/bin/env python3
"""Focused tests for Mango's AIOMetadata configuration policy."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))

from aiometadata_mango import (
    apply_self_host_api_keys,
    build_mango_config_with_extras,
    normalize_metadata_providers,
)


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

    def test_build_supplies_age_rating_required_by_tvmaze(self) -> None:
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            export_path = root / "export.json"
            catalog_path = root / "catalog.yaml"
            env_path = root / ".env"
            export_path.write_text(
                '{"config":{"providers":{"movie":"tmdb","series":"tvdb"},'
                '"apiKeys":{},"catalogs":[]}}',
                encoding="utf-8",
            )
            catalog_path.write_text("rails: []\n", encoding="utf-8")
            env_path.write_text("", encoding="utf-8")

            config, _warnings = build_mango_config_with_extras(
                export_path,
                catalog_path,
                env_path,
                set(),
            )

        self.assertEqual(config["providers"]["series"], "tvmaze")
        self.assertEqual(config["ageRating"], "none")


if __name__ == "__main__":
    unittest.main()
