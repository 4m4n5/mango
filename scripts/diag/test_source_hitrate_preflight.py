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
    per_source_for_preset,
    report_age_hours,
    should_skip_preflight,
)


class SourceHitratePreflightTests(unittest.TestCase):
    def test_per_source_for_preset(self) -> None:
        self.assertEqual(per_source_for_preset("quick"), 1)
        self.assertEqual(per_source_for_preset("nightly"), 3)

    def test_should_skip_when_fresh(self) -> None:
        previous = os.environ.get("MANGO_SOURCE_HITRATE_OUT")
        with tempfile.TemporaryDirectory() as tmp:
            try:
                report = Path(tmp) / "latest.json"
                os.environ["MANGO_SOURCE_HITRATE_OUT"] = str(report)
                report.write_text(
                    json.dumps({"ts": int(time.time())}),
                    encoding="utf-8",
                )
                age = report_age_hours(report)
                assert age is not None
                self.assertLess(age, 0.1)
                self.assertTrue(should_skip_preflight("quick", force=False)[0])
                self.assertTrue(should_skip_preflight("nightly", force=False)[0])
                self.assertFalse(should_skip_preflight("nightly", force=True)[0])
            finally:
                if previous is None:
                    os.environ.pop("MANGO_SOURCE_HITRATE_OUT", None)
                else:
                    os.environ["MANGO_SOURCE_HITRATE_OUT"] = previous


if __name__ == "__main__":
    unittest.main()
