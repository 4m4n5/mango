#!/usr/bin/env python3
"""Tests for rail-health.py (Q3 rail-miss-N-nights operator digest)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from importlib import import_module

rail_health = import_module("rail-health")


def night(generated_at: float, rails: list[dict]) -> dict:
    return {"generated_at": generated_at, "rails": rails}


def rail_row(rail_id: str, met: bool, *, grow_target: int = 20, yield_: int = 0) -> dict:
    return {
        "rail_id": rail_id,
        "grow_target": grow_target,
        "new_to_rail_verified": yield_,
        "grow_target_met": met,
    }


class ComputeStarvingRailsTests(unittest.TestCase):
    def test_three_consecutive_misses_trip_default_threshold(self) -> None:
        history = [
            night(1_000, [rail_row("series-anime-picks", False, yield_=4)]),
            night(2_000, [rail_row("series-anime-picks", False, yield_=1)]),
            night(3_000, [rail_row("series-anime-picks", False, yield_=0)]),
        ]
        starving = rail_health.compute_starving_rails(history, threshold=3)
        self.assertEqual(len(starving), 1)
        self.assertEqual(starving[0]["rail_id"], "series-anime-picks")
        self.assertEqual(starving[0]["nights_missed"], 3)
        self.assertEqual(starving[0]["last_yield"], 0)

    def test_two_misses_below_default_threshold_is_not_starving(self) -> None:
        history = [
            night(1_000, [rail_row("series-anime-picks", False)]),
            night(2_000, [rail_row("series-anime-picks", False)]),
        ]
        self.assertEqual(rail_health.compute_starving_rails(history, threshold=3), [])

    def test_a_met_night_resets_the_streak(self) -> None:
        history = [
            night(1_000, [rail_row("movies-india-thriller", False)]),
            night(2_000, [rail_row("movies-india-thriller", False)]),
            night(3_000, [rail_row("movies-india-thriller", True, yield_=21)]),
        ]
        self.assertEqual(rail_health.compute_starving_rails(history, threshold=3), [])

    def test_threshold_is_configurable(self) -> None:
        history = [
            night(1_000, [rail_row("movies-korean-drama", False)]),
            night(2_000, [rail_row("movies-korean-drama", False)]),
        ]
        starving = rail_health.compute_starving_rails(history, threshold=2)
        self.assertEqual(len(starving), 1)
        self.assertEqual(starving[0]["nights_missed"], 2)


class RefreshJsonParsingTests(unittest.TestCase):
    def test_load_rail_growth_history_skips_deferred_and_stale_mode(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ops_dir = Path(tmp)
            (ops_dir / "refresh-playability-20260101-030000.json").write_text(
                json.dumps({
                    "mode": "nightly",
                    "started_at": 1_700_000_000_000,
                    "rails": [
                        {"rail_id": "movies-a", "grow_target": 20, "new_to_rail_verified": 3, "grow_target_met": False},
                    ],
                }),
                encoding="utf-8",
            )
            (ops_dir / "refresh-playability-20260101-040000-deferred.json").write_text(
                json.dumps({"deferred": True}), encoding="utf-8",
            )
            (ops_dir / "refresh-playability-20260101-050000.json").write_text(
                json.dumps({"mode": "stale", "rails": []}), encoding="utf-8",
            )
            history = rail_health.load_rail_growth_history(ops_dir)
            self.assertEqual(len(history), 1)
            self.assertEqual(history[0]["rails"][0]["rail_id"], "movies-a")

    def test_grow_target_met_falls_back_to_yield_comparison(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ops_dir = Path(tmp)
            (ops_dir / "refresh-playability-20260101-030000.json").write_text(
                json.dumps({
                    "mode": "grow",
                    "started_at": 1_700_000_000_000,
                    "rails": [
                        {"rail_id": "movies-b", "grow_target": 20, "new_to_rail_verified": 25},
                    ],
                }),
                encoding="utf-8",
            )
            history = rail_health.load_rail_growth_history(ops_dir)
            self.assertTrue(history[0]["rails"][0]["grow_target_met"])


if __name__ == "__main__":
    unittest.main()
