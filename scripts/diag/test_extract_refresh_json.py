#!/usr/bin/env python3
"""Tests for extract_refresh_json.py."""

from __future__ import annotations

import argparse
import json
import tempfile
import unittest
from pathlib import Path

from extract_refresh_json import enrich_payload, extract_refresh_payload, fallback_payload


class ExtractRefreshJsonTests(unittest.TestCase):
    def test_extracts_pure_json_payload(self) -> None:
        raw = json.dumps(
            {
                "ok": False,
                "mode": "grow",
                "duration_ms": 1200,
                "failure_category": "low_stream_hit_rate",
                "rails": [{"rail_id": "series-india-picks"}],
            }
        )

        payload = extract_refresh_payload(raw)

        assert payload is not None
        self.assertEqual(payload["mode"], "grow")
        self.assertEqual(payload["rails"][0]["rail_id"], "series-india-picks")

    def test_extracts_refresh_payload_from_noisy_output(self) -> None:
        raw = "\n".join(
            [
                "warn: optional source skipped",
                '{"not_the_report": true}',
                json.dumps(
                    {
                        "ok": False,
                        "mode": "grow",
                        "duration_ms": 193724,
                        "failure_category": "low_stream_hit_rate",
                        "rails": [
                            {
                                "rail_id": "series-india-picks",
                                "new_to_rail_verified": 1,
                            }
                        ],
                    },
                    indent=2,
                ),
                "refresh failed",
            ]
        )

        payload = extract_refresh_payload(raw)

        assert payload is not None
        self.assertEqual(payload["failure_category"], "low_stream_hit_rate")
        self.assertEqual(payload["rails"][0]["new_to_rail_verified"], 1)

    def test_fallback_uses_grow_state_when_no_payload_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "grow-run-state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "stage": "verify",
                        "failure_category": "low_stream_hit_rate",
                        "rail_id": "series-india-picks",
                        "fresh_verified": 1,
                        "candidates_seen": 160,
                        "message": "rail shortfall",
                    }
                ),
                encoding="utf-8",
            )
            args = argparse.Namespace(
                mode="grow",
                run_id="playability-20260624-182628",
                start_ms=1000,
                end_ms=2500,
                rc=1,
                state_path=str(state_path),
            )

            payload = fallback_payload(args, "traceback only")

        self.assertFalse(payload["ok"])
        self.assertEqual(payload["run_id"], "playability-20260624-182628")
        self.assertEqual(payload["duration_ms"], 1500)
        self.assertEqual(payload["failure_category"], "low_stream_hit_rate")
        self.assertEqual(payload["rail_id"], "series-india-picks")
        self.assertEqual(payload["fresh_verified"], 1)
        self.assertIn("Do not use older refresh JSON", payload["repair_suggestions"][1])

    def test_enriches_extracted_payload_with_maintenance_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "grow-run-state.json"
            state_path.write_text(
                json.dumps({"stage": "strict_grow_sla", "rail_id": "series-india-picks"}),
                encoding="utf-8",
            )
            args = argparse.Namespace(
                mode="grow",
                run_id="playability-20260624-183852",
                start_ms=1000,
                end_ms=2500,
                rc=1,
                state_path=str(state_path),
            )

            payload = enrich_payload(
                {
                    "ok": False,
                    "failure_category": "rail_grow_target_shortfall",
                    "rails": [],
                },
                args,
            )

        self.assertEqual(payload["run_id"], "playability-20260624-183852")
        self.assertEqual(payload["mode"], "grow")
        self.assertEqual(payload["stage"], "strict_grow_sla")
        self.assertEqual(payload["started_at"], 1000)
        self.assertEqual(payload["finished_at"], 2500)
        self.assertEqual(payload["maintenance_rc"], 1)
        self.assertEqual(payload["grow_state"]["rail_id"], "series-india-picks")


if __name__ == "__main__":
    unittest.main()
