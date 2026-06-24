#!/usr/bin/env python3
"""Tests for Library Grower SLA assessment."""

from __future__ import annotations

import unittest
import os

from ops_grow_sla import (
    PROGRAM_PASS_RATE,
    RailPlayabilityConfig,
    assess_rail_sla,
    collect_grow_rail_rows,
    resolve_grow_target,
    summarize_grow_sla,
)


class GrowSlaTests(unittest.TestCase):
    def test_resolve_grow_target_uses_grow_per_pass_for_sparse_rails(self) -> None:
        cfg = RailPlayabilityConfig(display_limit=9, grow_per_pass=20)
        self.assertEqual(resolve_grow_target(cfg, 8), 20)
        self.assertEqual(resolve_grow_target(cfg, 9), 20)

    def test_anchor_rails_are_included_by_default(self) -> None:
        cfg = RailPlayabilityConfig(display_limit=9, grow_per_pass=20, pool_target=20)
        previous = os.environ.pop("MANGO_GROW_ANCHOR_DIET", None)
        try:
            self.assertEqual(resolve_grow_target(cfg, 120, "movies-global-popular"), 20)
            os.environ["MANGO_GROW_ANCHOR_DIET"] = "1"
            self.assertEqual(resolve_grow_target(cfg, 120, "movies-global-popular"), 0)
        finally:
            if previous is None:
                os.environ.pop("MANGO_GROW_ANCHOR_DIET", None)
            else:
                os.environ["MANGO_GROW_ANCHOR_DIET"] = previous

    def test_assess_rail_met(self) -> None:
        row = {
            "rail_id": "movies-test",
            "label": "Test",
            "verified_before": 30,
            "grow_target": 20,
            "fresh_verified": 22,
            "probe_verified": 22,
            "grow_target_met": True,
            "exhausted": False,
        }
        result = assess_rail_sla(row)
        assert result is not None
        self.assertEqual(result.status, "ok")
        self.assertTrue(result.grow_target_met)

    def test_pool_growth_does_not_satisfy_quota_without_fresh_probes(self) -> None:
        row = {
            "rail_id": "movies-shuffle",
            "verified_before": 100,
            "grow_target": 20,
            "pool_growth": 20,
            "fresh_verified": 0,
            "probe_verified": 0,
            "linked_existing": 20,
            "grow_target_met": False,
            "exhausted": True,
        }
        result = assess_rail_sla(row)
        assert result is not None
        self.assertEqual(result.probe_verified, 0)
        self.assertFalse(result.grow_target_met)
        self.assertEqual(result.status, "warn")

    def test_assess_rail_exhausted_warn(self) -> None:
        row = {
            "rail_id": "movies-thin",
            "verified_before": 12,
            "grow_target": 20,
            "probe_verified": 4,
            "exhausted": True,
            "compose_escalated": True,
            "compose_fallback_level": 2,
        }
        result = assess_rail_sla(row)
        assert result is not None
        self.assertEqual(result.status, "warn")
        self.assertIn("exhausted", result.reason or "")
        self.assertIn("compose fallback 2", result.reason or "")

    def test_collect_from_maintenance_payload(self) -> None:
        events = [
            {
                "kind": "playability_maintenance",
                "payload": {
                    "mode": "grow",
                    "rails": [
                        {
                            "rail_id": "movies-a",
                            "before": {"verified_pool": 10},
                            "after": {"verified_pool": 28},
                            "probe_verified": 18,
                            "grow_target": 20,
                            "grow_target_met": False,
                            "exhausted": False,
                        },
                    ],
                },
            },
        ]
        rows = collect_grow_rail_rows(events)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["probe_verified"], 18)

    def test_program_pass_rate(self) -> None:
        events = [
            {
                "kind": "playability_growth",
                "payload": {
                    "mode": "grow",
                    "rails": [
                        {
                            "rail_id": f"rail-{index}",
                            "grow_target": 20,
                            "probe_verified": 20 if index < 8 else 2,
                            "grow_target_met": index < 8,
                            "verified_before": 20,
                        }
                        for index in range(10)
                    ],
                },
            },
        ]
        summary = summarize_grow_sla(events, catalog={})
        assert summary is not None
        self.assertEqual(summary.met_count, 8)
        self.assertEqual(summary.browse_rail_count, 10)
        self.assertAlmostEqual(summary.program_pass_rate, 0.8)
        self.assertFalse(summary.program_pass)
        self.assertGreaterEqual(PROGRAM_PASS_RATE, 0.8)

    def test_all_rails_required_for_program_pass(self) -> None:
        events = [
            {
                "kind": "playability_growth",
                "payload": {
                    "mode": "grow",
                    "rails": [
                        {
                            "rail_id": f"rail-{index}",
                            "grow_target": 20,
                            "new_to_rail_verified": 20,
                            "grow_target_met": True,
                            "verified_before": 20,
                        }
                        for index in range(13)
                    ],
                },
            },
        ]
        summary = summarize_grow_sla(events, catalog={})
        assert summary is not None
        self.assertEqual(summary.met_count, 13)
        self.assertEqual(summary.browse_rail_count, 13)
        self.assertTrue(summary.program_pass)


if __name__ == "__main__":
    unittest.main()
