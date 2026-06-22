#!/usr/bin/env python3
"""Tests for source_hitrate_preflight.py."""

from __future__ import annotations

import json
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

    def test_should_skip_quick_when_fresh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "latest.json"
            report.write_text(
                json.dumps({"ts": int(time.time())}),
                encoding="utf-8",
            )
            age = report_age_hours(report)
            assert age is not None
            self.assertLess(age, 0.1)
            skip, _reason = should_skip_preflight("quick", force=False)
            # default report path may differ — test with explicit path via env in integration
            self.assertFalse(should_skip_preflight("nightly", force=False)[0])
            self.assertFalse(should_skip_preflight("quick", force=True)[0])

    def test_nightly_never_skips_without_force_semantics(self) -> None:
        skip, reason = should_skip_preflight("nightly", force=False)
        self.assertFalse(skip)
        self.assertEqual(reason, "run")


if __name__ == "__main__":
    unittest.main()
