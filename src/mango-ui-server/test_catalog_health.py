#!/usr/bin/env python3
"""Unit tests for catalog health optional-Live contract."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import serve  # noqa: E402


def catalog_health(payload: dict[str, object]) -> dict[str, object]:
    return {
        "ok": bool(payload.get("ok"))
        and payload.get("core") == "ready"
        and bool(payload.get("rails_ready"))
        and serve.catalog_live_ready_from_health(payload),
        "core": str(payload.get("core", "")),
        "rails_ready": bool(payload.get("rails_ready")),
        "live_ready": serve.catalog_live_ready_from_health(payload),
    }


class CatalogHealthTests(unittest.TestCase):
    def test_explicit_disabled_live_is_healthy(self) -> None:
        health = catalog_health({
            "ok": True,
            "core": "ready",
            "rails_ready": True,
            "live_rails": 0,
            "live_ready": False,
            "live": {
                "ready": False,
                "config_ready": False,
                "sources": [],
                "cache": {"fresh": False, "non_empty": False},
            },
        })
        self.assertTrue(health["ok"])
        self.assertTrue(health["live_ready"])

    def test_configured_broken_live_is_unhealthy(self) -> None:
        health = catalog_health({
            "ok": True,
            "core": "ready",
            "rails_ready": True,
            "live_rails": 1,
            "live_ready": False,
            "live": {
                "ready": False,
                "config_ready": False,
                "sources": [{"addon": "mango Live TV", "catalog": "tv"}],
            },
        })
        self.assertFalse(health["ok"])
        self.assertFalse(health["live_ready"])

    def test_malformed_configured_live_is_unhealthy(self) -> None:
        health = catalog_health({
            "ok": True,
            "core": "ready",
            "rails_ready": True,
            "live_rails": 0,
            "live_ready": False,
            "live": {
                "ready": False,
                "config_ready": False,
                "config_error": "live catalog rails must be a non-empty array",
                "sources": [],
            },
        })
        self.assertFalse(health["ok"])
        self.assertFalse(health["live_ready"])

    def test_malformed_live_rail_count_stays_unhealthy(self) -> None:
        health = catalog_health({
            "ok": True,
            "core": "ready",
            "rails_ready": True,
            "live_rails": "oops",
            "live_ready": False,
            "live": {
                "ready": False,
                "config_ready": False,
                "sources": [],
            },
        })
        self.assertFalse(health["ok"])
        self.assertFalse(health["live_ready"])

    def test_malformed_live_sources_stay_unhealthy(self) -> None:
        health = catalog_health({
            "ok": True,
            "core": "ready",
            "rails_ready": True,
            "live_rails": 0,
            "live_ready": False,
            "live": {
                "ready": False,
                "config_ready": False,
                "sources": {"addon": "mango Live TV"},
            },
        })
        self.assertFalse(health["ok"])
        self.assertFalse(health["live_ready"])

    def test_configured_live_missing_readiness_fields_stays_unhealthy(self) -> None:
        health = catalog_health({
            "ok": True,
            "core": "ready",
            "rails_ready": True,
            "live_rails": 1,
            "live": {
                "config_ready": True,
                "sources": [{"addon": "mango Live TV", "catalog": "tv"}],
            },
        })
        self.assertFalse(health["ok"])
        self.assertFalse(health["live_ready"])

    def test_legacy_absent_live_fields_stay_healthy(self) -> None:
        health = catalog_health({"ok": True, "core": "ready", "rails_ready": True})
        self.assertTrue(health["ok"])
        self.assertTrue(health["live_ready"])

    def test_legacy_live_ready_false_stays_unhealthy(self) -> None:
        top_level = catalog_health({
            "ok": True,
            "core": "ready",
            "rails_ready": True,
            "live_ready": False,
        })
        nested = catalog_health({
            "ok": True,
            "core": "ready",
            "rails_ready": True,
            "live": {"ready": False},
        })
        self.assertFalse(top_level["ok"])
        self.assertFalse(nested["ok"])


if __name__ == "__main__":
    unittest.main()
