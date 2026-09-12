import importlib.util
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location("restore_expiry", Path(__file__).with_name("restore-expiry-only-visibility.py"))
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class RestorationTests(unittest.TestCase):
    def setUp(self):
        self.baseline = sqlite3.connect(":memory:")
        self.live = sqlite3.connect(":memory:")
        for db in (self.baseline, self.live):
            db.row_factory = sqlite3.Row
            db.executescript("""
CREATE TABLE titles(type TEXT, id TEXT, status TEXT, fail_reason TEXT, updated_at INTEGER,
 verified_at INTEGER, first_verified_at INTEGER, expires_at INTEGER, best_source TEXT,
 cache_status TEXT, debrid_service TEXT, probe_ms INTEGER, win_url_hash TEXT,
 win_ladder_step TEXT, proof_version INTEGER, proof_run_id TEXT, proof_exact_main INTEGER,
 PRIMARY KEY(type,id));
CREATE TABLE verify_log(id INTEGER PRIMARY KEY, type TEXT, id_value TEXT, stage TEXT,
 outcome TEXT, started_at INTEGER);
CREATE TABLE playability_retry_queue(type TEXT,id TEXT,reason TEXT,priority INTEGER,
 attempt_count INTEGER,requested_at INTEGER,last_attempt_at INTEGER,
 next_eligible_at INTEGER,resume_position INTEGER,PRIMARY KEY(type,id));
""")
            db.execute("""INSERT INTO titles VALUES
('movie','tt1','verified',NULL,10,5,5,20,'aio','cached','service',100,'hash','1080p',1,NULL,0)""")
        self.live.execute("UPDATE titles SET status='stale',updated_at=30")
        self.live.execute("INSERT INTO verify_log VALUES(1,'movie','tt1','sweep','expired_stale',30)")

    def tearDown(self):
        self.live.close()
        self.baseline.close()

    def test_restore_preserves_evidence_and_inventory(self):
        rows, report = restore.plan(self.live, self.baseline)
        self.assertEqual(report["eligible"], 1)
        restore.apply_plan(self.live, rows)
        after = dict(self.live.execute("SELECT * FROM titles").fetchone())
        self.assertEqual(after, {**rows[0], "fail_reason": "expired_stale"})
        self.assertEqual(after["status"], "stale")
        self.assertEqual(self.live.execute("SELECT reason FROM playability_retry_queue").fetchone()[0], "expired_stale")
        self.assertEqual(restore.plan(self.live, self.baseline)[1]["eligible"], 0)

    def test_apply_requires_visibility_schema_and_trigger(self):
        self.live.execute("CREATE TABLE playability_migrations(version INTEGER)")
        self.live.execute("INSERT INTO playability_migrations VALUES(20)")
        with self.assertRaisesRegex(RuntimeError, "schema 21"):
            restore.require_visibility_schema(self.live)
        self.live.execute("UPDATE playability_migrations SET version=21")
        with self.assertRaisesRegex(RuntimeError, "schema 21"):
            restore.require_visibility_schema(self.live)
        self.live.execute("""CREATE TRIGGER recommendation_corpus_titles_update
AFTER UPDATE OF fail_reason ON titles BEGIN SELECT 1; END""")
        restore.require_visibility_schema(self.live)

    def test_any_later_attempt_blocks_restoration(self):
        self.live.execute("INSERT INTO verify_log VALUES(2,'movie','tt1','probe','timeout',31)")
        self.assertEqual(restore.plan(self.live, self.baseline)[1]["eligible"], 0)

    def test_later_sweep_does_not_conceal_intervening_failure(self):
        self.live.execute("UPDATE verify_log SET stage='probe',outcome='timeout',started_at=25")
        self.live.execute("INSERT INTO verify_log VALUES(2,'movie','tt1','sweep','expired_stale',30)")
        self.assertEqual(restore.plan(self.live, self.baseline)[1]["eligible"], 0)

    def test_changed_proof_blocks_restoration(self):
        self.live.execute("UPDATE titles SET win_url_hash='new'")
        self.assertEqual(restore.plan(self.live, self.baseline)[1]["eligible"], 0)

    def test_changed_update_timestamp_blocks_restoration(self):
        self.live.execute("UPDATE titles SET updated_at=31")
        self.assertEqual(restore.plan(self.live, self.baseline)[1]["eligible"], 0)

    def test_identity_collision_blocks_restoration(self):
        self.live.execute("INSERT INTO titles(type,id,status,updated_at) VALUES('series','tt1','failed',1)")
        self.assertEqual(restore.plan(self.live, self.baseline)[1]["eligible"], 0)

    def test_failures_are_never_restored(self):
        for status, reason in (("stale", "timeout"), ("failed", None), ("pending", None),
                               ("stale", "identity_type_collision"), ("stale", "play_miss")):
            self.live.execute("UPDATE titles SET status=?,fail_reason=?", (status, reason))
            self.assertEqual(restore.plan(self.live, self.baseline)[1]["eligible"], 0)

    def test_sweeps_before_baseline_are_not_evidence(self):
        self.baseline.execute("INSERT INTO verify_log VALUES(1,'movie','tt1','other','verified',10)")
        self.assertEqual(restore.plan(self.live, self.baseline)[1]["eligible"], 0)

    def test_episode_cannot_be_restored_as_show(self):
        for db in (self.baseline, self.live):
            db.execute("UPDATE titles SET type='series',id='tt1:2:1'")
        self.live.execute("UPDATE verify_log SET type='series',id_value='tt1:2:1'")
        self.assertEqual(restore.plan(self.live, self.baseline)[1]["eligible"], 0)

    def test_existing_retry_backoff_is_preserved(self):
        self.live.execute("INSERT INTO playability_retry_queue VALUES('movie','tt1','expired_stale',70,4,30,40,60,0)")
        rows, _ = restore.plan(self.live, self.baseline)
        restore.apply_plan(self.live, rows)
        self.assertEqual(tuple(self.live.execute("SELECT attempt_count,next_eligible_at FROM playability_retry_queue").fetchone()), (4, 60))

    def test_existing_retry_reason_is_not_overwritten(self):
        self.live.execute("INSERT INTO playability_retry_queue VALUES('movie','tt1','timeout',90,2,31,40,80,0)")
        rows, report = restore.plan(self.live, self.baseline)
        self.assertEqual(rows, [])
        self.assertEqual(report["excluded"], {"conflicting_retry_evidence": 1})
        row = tuple(self.live.execute(
            "SELECT reason,priority,attempt_count,next_eligible_at FROM playability_retry_queue",
        ).fetchone())
        self.assertEqual(row, ("timeout", 90, 2, 80))

    def test_apply_detects_candidate_race_before_enqueue(self):
        rows, _ = restore.plan(self.live, self.baseline)
        self.live.execute("UPDATE titles SET fail_reason='timeout'")
        with self.assertRaisesRegex(RuntimeError, "candidate changed"):
            restore.apply_plan(self.live, rows)
        self.assertEqual(self.live.execute("SELECT COUNT(*) FROM playability_retry_queue").fetchone()[0], 0)

    def test_future_expiry_timestamp_blocks_restoration(self):
        for db in (self.baseline, self.live):
            db.execute("UPDATE titles SET expires_at=31")
        self.assertEqual(restore.plan(self.live, self.baseline)[1]["eligible"], 0)
        self.assertEqual(
            restore.plan(self.live, self.baseline)[1]["excluded"],
            {"inconsistent_expiry_timestamps": 1},
        )

    def test_baseline_updated_after_sweep_blocks_restoration(self):
        self.baseline.execute("UPDATE titles SET updated_at=31")
        self.assertEqual(restore.plan(self.live, self.baseline)[1]["eligible"], 0)
        self.assertEqual(
            restore.plan(self.live, self.baseline)[1]["excluded"],
            {"inconsistent_expiry_timestamps": 1},
        )


if __name__ == "__main__":
    unittest.main()
