#!/usr/bin/env python3
import json
import multiprocessing
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ops_ledger import append_json_line, write_json_atomic


def append_worker(path: str, index: int) -> None:
    append_json_line(Path(path), {"run_id": f"run-{index}", "index": index})


class OpsLedgerTest(unittest.TestCase):
    def test_concurrent_append_keeps_every_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.jsonl"
            workers = [multiprocessing.Process(target=append_worker, args=(str(path), index)) for index in range(12)]
            for worker in workers:
                worker.start()
            for worker in workers:
                worker.join(5)
                self.assertEqual(worker.exitcode, 0)
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual({row["run_id"] for row in rows}, {f"run-{index}" for index in range(12)})

    def test_report_replace_is_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ops" / "reports" / "2026-08-11" / "run.json"
            write_json_atomic(path, {"run_id": "run-1", "state": "partial"})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["state"], "partial")


if __name__ == "__main__":
    unittest.main()
