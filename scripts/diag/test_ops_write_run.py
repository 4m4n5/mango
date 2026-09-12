#!/usr/bin/env python3
"""Regression coverage for maintenance logging before staged DB publication."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ops_ledger import MAX_EVENT_BYTES, append_json_line
from ops_grow_sla import collect_grow_rail_rows

SCRIPT = Path(__file__).with_name("ops-write-run.py")
SPEC = importlib.util.spec_from_file_location("ops_write_run", SCRIPT)
writer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(writer)


def grow_payload() -> dict:
    return {
        "ok": True,
        "mode": "grow",
        "all_rails_publishable": True,
        "verified": 60,
        "failed": 4,
        "duration_ms": 300000,
        "batch_flush": {"verify_count": 60, "pool_count": 82},
        "rails": [
            {
                "rail_id": f"movies-{index}",
                "label": f"Rail {index}",
                "before": {"verified_pool": 10, "pool_depth": 20},
                "after": {"verified_pool": 30, "pool_depth": 40},
                "new_to_rail_verified": 20,
                "grow_target": 20,
                "grow_target_met": True,
                "exhausted": False,
                "results": [
                    {"id": f"tt{index:03d}{item:04d}", "status": "verified", "diagnostics": "x" * 1000}
                    for item in range(60)
                ],
            }
            for index in range(24)
        ],
    }


class OpsWriteRunTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.environment = patch.dict(os.environ, {"XDG_CACHE_HOME": self.directory.name})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.root = Path(self.directory.name) / "mango" / "ops"

    def events(self) -> list[dict]:
        return [json.loads(line) for line in (self.root / "events.jsonl").read_text().splitlines()]

    def run_cli(self, payload: object, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--kind", "playability_maintenance", "--summary", "grow rc=0",
             "--payload-file", "-", *args],
            input=json.dumps(payload, ensure_ascii=False), text=True, capture_output=True, check=False,
        )

    def test_large_real_shaped_grow_retains_report_counters_and_rail_contract(self) -> None:
        payload = grow_payload()
        self.assertGreater(writer.encoded_size(payload), MAX_EVENT_BYTES)
        result = self.run_cli(payload, "--run-id", "grow-1", "--write-report")
        self.assertEqual(result.returncode, 0, result.stderr)
        event = self.events()[0]
        summary = event["payload"]
        report = json.loads(Path(summary["report_path"]).read_text())
        self.assertLess(writer.encoded_size(event), MAX_EVENT_BYTES)
        self.assertTrue(summary["payload_in_report"])
        for key in ("mode", "ok", "all_rails_publishable", "verified", "failed", "duration_ms", "batch_flush"):
            self.assertEqual(summary[key], payload[key])
        for key, value in payload.items():
            self.assertEqual(report[key], value)
        self.assertEqual(collect_grow_rail_rows([event]), collect_grow_rail_rows([], [report]))
        self.assertNotIn("results", summary["rails"][0])

    def test_unicode_size_is_utf8_bytes_not_character_count(self) -> None:
        payload = {"mode": "grow", "details": "🥭" * 260000}
        self.assertLess(len(json.dumps(payload, ensure_ascii=False)), MAX_EVENT_BYTES)
        result = self.run_cli(payload, "--run-id", "unicode")
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = self.events()[0]["payload"]
        self.assertGreater(summary["original_event_bytes"], MAX_EVENT_BYTES)
        self.assertEqual(json.loads(Path(summary["report_path"]).read_text())["details"], payload["details"])

    def test_report_is_durable_before_referenced_event_is_appended(self) -> None:
        original_append = writer.append_json_line

        def inspect_then_append(path: Path, event: dict) -> None:
            report_path = Path(event["payload"]["report_path"])
            self.assertEqual(json.loads(report_path.read_text())["details"], "x" * MAX_EVENT_BYTES)
            self.assertEqual(report_path.stat().st_mode & 0o777, 0o600)
            self.assertFalse(list(report_path.parent.glob(".*.json.*")))
            original_append(path, event)

        with patch.object(writer, "append_json_line", side_effect=inspect_then_append):
            writer.append_event("maintenance", "done", {"details": "x" * MAX_EVENT_BYTES}, run_id="durable")

    def test_small_payload_and_envelope_stay_compatible(self) -> None:
        payload = {"ok": False, "mode": "grow", "rails": [{"rail_id": "movies", "results": [1, 2]}]}
        result = self.run_cli(payload, "--run-id", "small", "--source", "maintenance", "--write-report")
        self.assertEqual(result.returncode, 0, result.stderr)
        event = self.events()[0]
        self.assertEqual(set(event), {"ts", "kind", "run_id", "source", "summary", "payload"})
        self.assertEqual(event["payload"], payload)
        self.assertEqual(event["run_id"], "small")
        self.assertEqual(event["source"], "maintenance")
        reports = list((self.root / "reports").glob("*/small.json"))
        self.assertEqual(len(reports), 1)
        self.assertEqual(json.loads(reports[0].read_text())["rails"], payload["rails"])

    def test_small_without_report_flag_does_not_create_report(self) -> None:
        result = self.run_cli({"verified": 2}, "--run-id", "small")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events()[0]["payload"], {"verified": 2})
        self.assertFalse((self.root / "reports").exists())

    def test_large_without_report_flag_or_run_id_creates_unique_reports(self) -> None:
        for _ in range(2):
            result = self.run_cli({"verified": 2, "details": "x" * MAX_EVENT_BYTES})
            self.assertEqual(result.returncode, 0, result.stderr)
        events = self.events()
        paths = {event["payload"]["report_path"] for event in events}
        self.assertEqual(len(paths), 2)
        self.assertTrue(all(Path(path).is_file() for path in paths))
        self.assertTrue(all(event["run_id"] is None for event in events))

    def test_report_failure_does_not_append_success_event(self) -> None:
        for payload, requested in (({"ok": True}, True), ({"details": "x" * MAX_EVENT_BYTES}, False)):
            with self.subTest(requested=requested), patch.object(writer, "write_run_report", side_effect=OSError("disk full")), \
                    patch.object(writer, "append_json_line") as append:
                with self.assertRaisesRegex(OSError, "disk full"):
                    writer.append_event("maintenance", "done", payload, run_id="failed", write_report=requested)
                append.assert_not_called()

    def test_repeated_run_id_cannot_overwrite_referenced_payloads(self) -> None:
        for marker in ("first", "second"):
            result = self.run_cli(
                {"marker": marker, "details": "x" * MAX_EVENT_BYTES},
                "--run-id", "shared-run", "--write-report",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
        result = self.run_cli({"marker": "final"}, "--run-id", "shared-run", "--write-report")
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.events()
        paths = [Path(event["payload"]["report_path"]) for event in events[:2]]
        self.assertNotEqual(paths[0], paths[1])
        self.assertEqual([json.loads(path.read_text())["marker"] for path in paths], ["first", "second"])
        self.assertTrue(all(event["run_id"] == "shared-run" for event in events))

    def test_ledger_failure_is_not_reported_as_success_and_full_report_survives(self) -> None:
        with patch.object(writer, "append_json_line", side_effect=OSError("ledger unavailable")):
            with self.assertRaisesRegex(OSError, "ledger unavailable"):
                writer.append_event("maintenance", "done", {"verified": 7}, run_id="saved", write_report=True)
        reports = list((self.root / "reports").glob("*/saved.json"))
        self.assertEqual(json.loads(reports[0].read_text())["verified"], 7)

    def test_huge_rail_summaries_are_bounded_and_incompleteness_is_explicit(self) -> None:
        payload = {"mode": "grow", "verified": 10, "rails": [
            {"rail_id": str(index), "label": "x" * 1000, "new_to_rail_verified": 1}
            for index in range(1200)
        ]}
        result = self.run_cli(payload, "--run-id", "many-rails")
        self.assertEqual(result.returncode, 0, result.stderr)
        event = self.events()[0]
        summary = event["payload"]
        self.assertLess(writer.encoded_size(event), 70 * 1024)
        self.assertEqual(summary["rails_total"], 1200)
        self.assertLess(summary["rails_summarized"], summary["rails_total"])
        self.assertEqual(len(json.loads(Path(summary["report_path"]).read_text())["rails"]), 1200)

    def test_shared_ledger_cap_still_rejects_oversize_direct_events(self) -> None:
        path = self.root / "events.jsonl"
        exact = {"x": "a" * (MAX_EVENT_BYTES - len('{"x":""}'))}
        self.assertEqual(writer.encoded_size(exact), MAX_EVENT_BYTES)
        append_json_line(path, exact)
        with self.assertRaisesRegex(ValueError, "exceeds 1MB"):
            append_json_line(path, {"x": exact["x"] + "a"})
        self.assertEqual(len(self.events()), 1)

    def test_non_object_payload_fails_without_event(self) -> None:
        result = self.run_cli(["invalid"])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("payload must be a JSON object", result.stderr)
        self.assertFalse((self.root / "events.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
