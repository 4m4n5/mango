"""Offline prune receipts must report actual nonnegative deletion counts."""
import importlib.util
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location(
    "mango_prune", Path(__file__).with_name("prune-mango-sqlite.py")
)
prune = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prune)


class PruneReceiptTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.execute("CREATE TABLE recommendation_refresh_jobs (job_id TEXT PRIMARY KEY, status TEXT, queued_at INTEGER)")

    def add(self, count):
        self.db.executemany(
            "INSERT INTO recommendation_refresh_jobs VALUES (?, ?, ?)",
            [(f"job-{n}", ["complete", "failed", "coalesced"][n % 3], n) for n in range(count)],
        )

    def test_empty_reports_zero(self):
        self.assertEqual(prune.prune_refresh_jobs(self.db), 0)

    def test_below_retention_reports_zero(self):
        self.add(5)
        self.assertEqual(prune.prune_refresh_jobs(self.db), 0)

    def test_counts_only_removed_terminal_jobs(self):
        self.add(25)
        self.db.executemany("INSERT INTO recommendation_refresh_jobs VALUES (?, ?, ?)", [
            ("pending", "queued", -2), ("working", "running", -1),
        ])
        self.assertEqual(prune.prune_refresh_jobs(self.db), 5)
        kept = {r[0] for r in self.db.execute("SELECT job_id FROM recommendation_refresh_jobs")}
        self.assertEqual(kept, {f"job-{n}" for n in range(5, 25)} | {"pending", "working"})

    def test_repeat_is_zero(self):
        self.add(25)
        self.assertEqual(prune.prune_refresh_jobs(self.db), 5)
        self.assertEqual(prune.prune_refresh_jobs(self.db), 0)


if __name__ == "__main__":
    unittest.main()
