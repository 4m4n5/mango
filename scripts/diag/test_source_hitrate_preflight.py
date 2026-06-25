#!/usr/bin/env python3
"""Tests for source_hitrate_preflight.py."""

from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path

from source_hitrate_preflight import (
    cmd_plan,
    missing_report_sources,
    per_source_for_preset,
    report_age_hours,
    should_skip_preflight,
)


class SourceHitratePreflightTests(unittest.TestCase):
    def test_grow_mode_maintenance_forwards_force_env(self) -> None:
        script = Path("scripts/m3-play/playability/playability-maintenance.sh")
        text = script.read_text(encoding="utf-8")
        self.assertIn('run_source_hitrate_preflight quick "${MANGO_SOURCE_HITRATE_FORCE:-0}"', text)

    def test_per_source_for_preset(self) -> None:
        self.assertEqual(per_source_for_preset("quick"), 1)
        self.assertEqual(per_source_for_preset("nightly"), 3)

    def test_should_skip_when_fresh(self) -> None:
        previous_report = os.environ.get("MANGO_SOURCE_HITRATE_OUT")
        previous_catalog = os.environ.get("MANGO_CATALOG_YAML")
        with tempfile.TemporaryDirectory() as tmp:
            try:
                catalog = Path(tmp) / "catalog.yaml"
                catalog.write_text(
                    """
version: 2
rails:
  - id: series-classics
    type: composite_list
    content_type: series
    sources:
      - { addon: AIOMetadata, catalog: mdblist.101882, weight: 1.0 }
""",
                    encoding="utf-8",
                )
                report = Path(tmp) / "latest.json"
                os.environ["MANGO_SOURCE_HITRATE_OUT"] = str(report)
                os.environ["MANGO_CATALOG_YAML"] = str(catalog)
                report.write_text(
                    json.dumps({
                        "ts": int(time.time()),
                        "sources": [
                            {
                                "source_key": "AIOMetadata|mdblist.101882|series",
                                "sampled": 1,
                                "stream_ok": 1,
                            }
                        ],
                    }),
                    encoding="utf-8",
                )
                age = report_age_hours(report)
                assert age is not None
                self.assertLess(age, 0.1)
                self.assertTrue(should_skip_preflight("quick", force=False)[0])
                self.assertTrue(should_skip_preflight("nightly", force=False)[0])
                self.assertFalse(should_skip_preflight("nightly", force=True)[0])
            finally:
                if previous_report is None:
                    os.environ.pop("MANGO_SOURCE_HITRATE_OUT", None)
                else:
                    os.environ["MANGO_SOURCE_HITRATE_OUT"] = previous_report
                if previous_catalog is None:
                    os.environ.pop("MANGO_CATALOG_YAML", None)
                else:
                    os.environ["MANGO_CATALOG_YAML"] = previous_catalog

    def test_missing_configured_sources_force_preflight(self) -> None:
        previous_report = os.environ.get("MANGO_SOURCE_HITRATE_OUT")
        previous_catalog = os.environ.get("MANGO_CATALOG_YAML")
        with tempfile.TemporaryDirectory() as tmp:
            try:
                catalog = Path(tmp) / "catalog.yaml"
                catalog.write_text(
                    """
version: 2
rails:
  - id: series-classics
    type: composite_list
    content_type: series
    sources:
      - { addon: AIOMetadata, catalog: mdblist.101882, weight: 0.5 }
      - { addon: AIOMetadata, catalog: mdblist.3086, weight: 0.5 }
""",
                    encoding="utf-8",
                )
                report = Path(tmp) / "latest.json"
                os.environ["MANGO_SOURCE_HITRATE_OUT"] = str(report)
                os.environ["MANGO_CATALOG_YAML"] = str(catalog)
                report.write_text(
                    json.dumps({
                        "ts": int(time.time()),
                        "sources": [
                            {"source_key": "AIOMetadata|mdblist.101882|series"}
                        ],
                    }),
                    encoding="utf-8",
                )

                self.assertEqual(missing_report_sources(report), ["AIOMetadata|mdblist.3086|series"])
                skip, reason = should_skip_preflight("nightly", force=False)
                self.assertFalse(skip)
                self.assertIn("missing 1 sources", reason)
            finally:
                if previous_report is None:
                    os.environ.pop("MANGO_SOURCE_HITRATE_OUT", None)
                else:
                    os.environ["MANGO_SOURCE_HITRATE_OUT"] = previous_report
                if previous_catalog is None:
                    os.environ.pop("MANGO_CATALOG_YAML", None)
                else:
                    os.environ["MANGO_CATALOG_YAML"] = previous_catalog

    def test_plan_probes_only_missing_sources_when_cache_is_fresh(self) -> None:
        previous_report = os.environ.get("MANGO_SOURCE_HITRATE_OUT")
        previous_catalog = os.environ.get("MANGO_CATALOG_YAML")
        with tempfile.TemporaryDirectory() as tmp:
            try:
                catalog = Path(tmp) / "catalog.yaml"
                catalog.write_text(
                    """
version: 2
rails:
  - id: series-classics
    type: composite_list
    content_type: series
    sources:
      - { addon: AIOMetadata, catalog: mdblist.101882, weight: 0.5 }
      - { addon: AIOMetadata, catalog: mdblist.3086, weight: 0.5 }
""",
                    encoding="utf-8",
                )
                report = Path(tmp) / "latest.json"
                os.environ["MANGO_SOURCE_HITRATE_OUT"] = str(report)
                os.environ["MANGO_CATALOG_YAML"] = str(catalog)
                report.write_text(
                    json.dumps({
                        "ts": int(time.time()),
                        "sources": [
                            {"source_key": "AIOMetadata|mdblist.101882|series"}
                        ],
                    }),
                    encoding="utf-8",
                )

                import argparse
                import contextlib
                import io

                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    cmd_plan(argparse.Namespace(preset="quick", force=False))
                plan = json.loads(out.getvalue())
                self.assertEqual(plan["probe_total"], 1)
                self.assertEqual(plan["probe_sources"], ["AIOMetadata|mdblist.3086|series"])
                self.assertTrue(plan["merge_cache"])
            finally:
                if previous_report is None:
                    os.environ.pop("MANGO_SOURCE_HITRATE_OUT", None)
                else:
                    os.environ["MANGO_SOURCE_HITRATE_OUT"] = previous_report
                if previous_catalog is None:
                    os.environ.pop("MANGO_CATALOG_YAML", None)
                else:
                    os.environ["MANGO_CATALOG_YAML"] = previous_catalog


if __name__ == "__main__":
    unittest.main()
