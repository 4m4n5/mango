#!/usr/bin/env python3
"""Tests for rail-health.py (Q3 rail-miss-N-nights operator digest)."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

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


def refresh_payload(generated_at: int, rails: list[dict], **overrides: object) -> dict:
    payload = {
        "ok": True,
        "mode": "grow",
        "maintenance_rc": 0,
        "all_rails_publishable": True,
        "started_at": generated_at - 1_000,
        "finished_at": generated_at,
        "rails": rails,
    }
    payload.update(overrides)
    return payload


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
    def test_catalog_path_uses_runtime_device_config_before_repo_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = root / "catalog.example.yaml"
            device = root / "catalog.yaml"
            repo.write_text("rails: [{id: repo}]\n", encoding="utf-8")
            device.write_text("rails: [{id: device}]\n", encoding="utf-8")
            with patch.dict(rail_health.os.environ, {"MANGO_CATALOG_YAML": ""}):
                self.assertEqual(rail_health._catalog_yaml_path(repo, device), device)
                device.unlink()
                self.assertEqual(rail_health._catalog_yaml_path(repo, device), repo)

    def test_active_vod_rails_match_enabled_catalog_and_ai_slots(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = root / "catalog.yaml"
            catalog.write_text(
                """rails:
  - {id: movies-active, type: composite_list, tab: movies}
  - {id: series-disabled, type: addon_catalog, tab: series, enabled: false}
  - {id: live-active, type: addon_catalog, tab: live}
""",
                encoding="utf-8",
            )
            slots = root / "ai-catalogs" / "slots"
            slots.mkdir(parents=True)
            (slots / "personal.yaml").write_text(
                "slot_id: personal\ntab: series\nenabled: true\n",
                encoding="utf-8",
            )
            (slots / "live.yaml").write_text(
                "slot_id: live-slot\ntab: live\nenabled: true\n",
                encoding="utf-8",
            )

            self.assertEqual(
                rail_health.active_vod_rail_ids(catalog, root / "ai-catalogs"),
                {"movies-active", "ai-personal"},
            )

    def test_load_rail_growth_history_skips_deferred_and_stale_mode(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ops_dir = Path(tmp)
            (ops_dir / "refresh-playability-20260101-030000.json").write_text(
                json.dumps(refresh_payload(
                    1_700_000_000_000,
                    [{"rail_id": "movies-a", "grow_target": 20, "new_to_rail_verified": 3, "grow_target_met": False}],
                    mode="nightly",
                )),
                encoding="utf-8",
            )
            (ops_dir / "refresh-playability-20260101-040000-deferred.json").write_text(
                json.dumps({"deferred": True}), encoding="utf-8",
            )
            (ops_dir / "refresh-playability-20260101-050000.json").write_text(
                json.dumps(refresh_payload(1_700_000_002_000, [], mode="stale")), encoding="utf-8",
            )
            history = rail_health.load_rail_growth_history(ops_dir)
            self.assertEqual(len(history), 1)
            self.assertEqual(history[0]["rails"][0]["rail_id"], "movies-a")

    def test_grow_target_met_falls_back_to_yield_comparison(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ops_dir = Path(tmp)
            (ops_dir / "refresh-playability-20260101-030000.json").write_text(
                json.dumps(refresh_payload(
                    1_700_000_000_000,
                    [{"rail_id": "movies-b", "grow_target": 20, "new_to_rail_verified": 25}],
                )),
                encoding="utf-8",
            )
            history = rail_health.load_rail_growth_history(ops_dir)
            self.assertTrue(history[0]["rails"][0]["grow_target_met"])

    def test_multiple_completed_artifacts_on_one_local_date_count_once(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ops_dir = Path(tmp)
            early = int(datetime(2026, 1, 1, 2, 0).timestamp() * 1000)
            late = int(datetime(2026, 1, 1, 18, 0).timestamp() * 1000)
            next_day = int(datetime(2026, 1, 2, 3, 0).timestamp() * 1000)
            (ops_dir / "refresh-playability-20260101-020000.json").write_text(
                json.dumps(refresh_payload(early, [rail_row("movies-b", False, yield_=1)])),
                encoding="utf-8",
            )
            (ops_dir / "refresh-playability-20260101-180000.json").write_text(
                json.dumps(refresh_payload(late, [rail_row("movies-b", False, yield_=5)])),
                encoding="utf-8",
            )
            (ops_dir / "refresh-playability-20260102-030000.json").write_text(
                json.dumps(refresh_payload(next_day, [rail_row("movies-b", False, yield_=2)])),
                encoding="utf-8",
            )

            history = rail_health.load_rail_growth_history(ops_dir)
            self.assertEqual(len(history), 2)
            self.assertEqual(history[0]["generated_at"], late)
            self.assertEqual(history[0]["rails"][0]["new_to_rail_verified"], 5)

    def test_incomplete_or_unpublishable_artifacts_do_not_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ops_dir = Path(tmp)
            base = 1_800_000_000_000
            payloads = [
                refresh_payload(base, [rail_row("movies-b", False)], ok=False),
                refresh_payload(base + 86_400_000, [rail_row("movies-b", False)], maintenance_rc=1),
                refresh_payload(base + 2 * 86_400_000, [rail_row("movies-b", False)], all_rails_publishable=False),
            ]
            for index, payload in enumerate(payloads):
                (ops_dir / f"refresh-playability-2026010{index + 1}-030000.json").write_text(
                    json.dumps(payload), encoding="utf-8",
                )

            self.assertEqual(rail_health.load_rail_growth_history(ops_dir), [])

    def test_history_filters_retired_rails_when_active_ids_are_supplied(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ops_dir = Path(tmp)
            generated_at = 1_800_000_000_000
            (ops_dir / "refresh-playability-20270115-030000.json").write_text(
                json.dumps(refresh_payload(generated_at, [
                    rail_row("movies-active", False, yield_=2),
                    rail_row("movies-retired", False, yield_=0),
                ])),
                encoding="utf-8",
            )

            history = rail_health.load_rail_growth_history(ops_dir, {"movies-active"})
            self.assertEqual(
                [row["rail_id"] for row in history[0]["rails"]],
                ["movies-active"],
            )

    def test_invalid_artifact_burst_cannot_evict_valid_dates(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ops_dir = Path(tmp)
            base = int(datetime(2026, 3, 1, 3, 0).timestamp() * 1000)
            for day in range(3):
                (ops_dir / f"refresh-playability-2026030{day + 1}-030000.json").write_text(
                    json.dumps(refresh_payload(
                        base + day * 86_400_000,
                        [rail_row("movies-active", False, yield_=1)],
                    )),
                    encoding="utf-8",
                )
            for index in range(121):
                (ops_dir / f"refresh-playability-20260401-invalid-{index:03d}.json").write_text(
                    json.dumps(refresh_payload(
                        base + 31 * 86_400_000 + index,
                        [rail_row("movies-active", False)],
                        ok=False,
                    )),
                    encoding="utf-8",
                )

            history = rail_health.load_rail_growth_history(ops_dir, {"movies-active"})
            self.assertEqual(len(history), 3)
            self.assertEqual(
                rail_health.compute_starving_rails(history, threshold=3)[0]["nights_missed"],
                3,
            )


if __name__ == "__main__":
    unittest.main()
