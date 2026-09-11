#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest

from recommendation_refresh_receipt import read_receipt


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="mango-recommendation-receipt-")
        self.addCleanup(self.tmp.cleanup)
        self.ops = Path(self.tmp.name)
        self.run_id = "playability-current-run"
        self.payload = {"ok": True, "status": "queued", "message": "desired_revision_recorded",
                        "job_ids": ["movie-job", "series-job"], "rc": 0}

    def write(self, payload=None, run_id=None):
        path = self.ops / f"recommendation-refresh-{run_id or self.run_id}.json"
        path.write_text(json.dumps(self.payload if payload is None else payload), encoding="utf-8")
        return path

    def test_exact_queued_receipt_preserves_async_contract(self):
        self.write()
        self.assertEqual(read_receipt(self.ops, self.run_id, 0),
                         ("queued", "desired_revision_recorded", 0))

    def test_missing_receipt_never_borrows_another_run(self):
        self.write(run_id="playability-other-run")
        self.assertEqual(read_receipt(self.ops, self.run_id, 0), ("unknown", "missing_result", 10))

    def test_stale_and_invalid_receipts_are_partial(self):
        path = self.write()
        os.utime(path, (1, 1))
        self.assertEqual(read_receipt(self.ops, self.run_id, 2000), ("unknown", "stale_result", 10))
        path.write_text("{bad", encoding="utf-8")
        self.assertEqual(read_receipt(self.ops, self.run_id, 0), ("unknown", "invalid_result", 10))
        self.write([])
        self.assertEqual(read_receipt(self.ops, self.run_id, 0), ("unknown", "invalid_result", 10))

    def test_malformed_and_unsuccessful_payloads_are_not_success(self):
        for change in ({"ok": False}, {"status": "warning"}, {"job_ids": []},
                       {"rc": "0"}, {"rc": False}, {"status": "unknown"}, {"status": []}):
            with self.subTest(change=change):
                self.write({**self.payload, **change})
                self.assertNotEqual(read_receipt(self.ops, self.run_id, 0)[2], 0)

    def test_only_explicit_operator_skip_is_success(self):
        for message, rc in (("disabled_by_env", 0), ("not_requested", 10)):
            self.write({**self.payload, "status": "skipped", "message": message})
            self.assertEqual(read_receipt(self.ops, self.run_id, 0)[2], rc)

    def test_no_path_traversal_or_raw_error_output(self):
        self.assertEqual(read_receipt(self.ops, "../../outside", 0)[2], 10)
        self.write({**self.payload, "ok": False, "message": "secret token=abcdef\nraw error"})
        self.assertEqual(read_receipt(self.ops, self.run_id, 0), ("queued", "invalid_message", 10))


if __name__ == "__main__":
    unittest.main()
