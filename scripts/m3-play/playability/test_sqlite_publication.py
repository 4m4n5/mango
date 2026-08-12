import importlib.util
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("sqlite-publication.py")
SPEC = importlib.util.spec_from_file_location("mango_sqlite_publication", MODULE_PATH)
assert SPEC and SPEC.loader
publication = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publication)


def make_db(path: Path, title_id: str, *, strict_valid: bool = True) -> None:
    with closing(sqlite3.connect(path)) as connection:
        connection.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE playability_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
            INSERT INTO playability_migrations VALUES(18, 1);
            CREATE TABLE titles(
              type TEXT NOT NULL,
              id TEXT NOT NULL,
              status TEXT NOT NULL,
              verified_at INTEGER,
              proof_version INTEGER NOT NULL DEFAULT 1,
              proof_exact_main INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY(type, id)
            );
            CREATE TABLE rail_pool(
              rail_id TEXT NOT NULL,
              type TEXT NOT NULL,
              id TEXT NOT NULL,
              PRIMARY KEY(rail_id, type, id)
            );
            """
        )
        connection.execute(
            "INSERT INTO titles VALUES('movie', ?, 'verified', 1, 2, ?)",
            (title_id, 1 if strict_valid else 0),
        )
        connection.execute(
            "INSERT INTO rail_pool VALUES('movies-global-popular', 'movie', ?)",
            (title_id,),
        )
        connection.commit()


class PublicationTest(unittest.TestCase):
    sha = "a" * 40
    config_hash = "b" * 64

    def test_publish_writes_and_reads_exact_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            live, staged, snapshot = root / "live.db", root / "staged.db", root / "snapshot.db"
            make_db(live, "tt-old")
            make_db(staged, "tt-new")
            result = publication.publish(
                staged,
                live,
                snapshot,
                publication_id="publication-1",
                run_id="run-1",
                git_sha=self.sha,
                config_hash=self.config_hash,
                published_at=1234,
            )
            self.assertTrue(result["ok"])
            self.assertEqual(result["publication"]["publication_id"], "publication-1")
            with closing(sqlite3.connect(live)) as connection:
                self.assertEqual(connection.execute("SELECT id FROM titles").fetchone()[0], "tt-new")

    def test_invalid_stage_never_changes_live(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            live, staged, snapshot = root / "live.db", root / "staged.db", root / "snapshot.db"
            make_db(live, "tt-old")
            make_db(staged, "tt-bad", strict_valid=False)
            with self.assertRaisesRegex(RuntimeError, "exact-main"):
                publication.publish(
                    staged,
                    live,
                    snapshot,
                    publication_id="publication-bad",
                    run_id="run-bad",
                    git_sha=self.sha,
                    config_hash=self.config_hash,
                )
            with closing(sqlite3.connect(live)) as connection:
                self.assertEqual(connection.execute("SELECT id FROM titles").fetchone()[0], "tt-old")

    def test_failures_at_every_post_copy_boundary_restore_verified_snapshot(self) -> None:
        for boundary in ("after_copy", "after_checkpoint", "after_readback"):
            with self.subTest(boundary=boundary), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                live, staged, snapshot = root / "live.db", root / "staged.db", root / "snapshot.db"
                make_db(live, "tt-old")
                make_db(staged, "tt-new")
                with self.assertRaisesRegex(RuntimeError, "injected failure"):
                    publication.publish(
                        staged,
                        live,
                        snapshot,
                        publication_id="publication-2",
                        run_id="run-2",
                        git_sha=self.sha,
                        config_hash=self.config_hash,
                        inject_failure=boundary,
                    )
                with closing(sqlite3.connect(live)) as connection:
                    self.assertEqual(connection.execute("SELECT id FROM titles").fetchone()[0], "tt-old")
                self.assertEqual(publication.validate_database(live)["quick_check"], "ok")


if __name__ == "__main__":
    unittest.main()
