#!/usr/bin/env python3
"""Validated in-place publication for Mango's fixed playability database.

The selected live database remains mutable after catalog restart. This helper
therefore provides a rollback window only until the new publication is
validated and read back; it does not implement whole-file generations.
"""

from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any


def _connect(path: Path, *, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, timeout=30)
    connection.execute("PRAGMA busy_timeout=30000")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def _table_exists(connection: sqlite3.Connection, name: str) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def _scalar(connection: sqlite3.Connection, sql: str) -> int:
    row = connection.execute(sql).fetchone()
    return int(row[0] if row else 0)


def validate_database(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise RuntimeError(f"database missing: {path}")
    with closing(_connect(path, readonly=True)) as connection:
        quick = connection.execute("PRAGMA quick_check").fetchone()
        if not quick or quick[0] != "ok":
            raise RuntimeError(f"quick_check failed for {path}: {quick}")
        foreign = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign:
            raise RuntimeError(f"foreign_key_check failed for {path}: {foreign[:5]}")
        required = {"titles", "rail_pool", "playability_migrations"}
        missing = sorted(name for name in required if not _table_exists(connection, name))
        if missing:
            raise RuntimeError(f"playability tables missing from {path}: {','.join(missing)}")
        title_columns = {
            str(row[1]) for row in connection.execute("PRAGMA table_info(titles)").fetchall()
        }
        has_strict_proof = {"proof_version", "proof_exact_main"}.issubset(title_columns)
        invalid_strict = _scalar(
            connection,
            """
            SELECT COUNT(*) FROM titles
            WHERE status='verified' AND proof_version >= 2 AND proof_exact_main != 1
            """,
        ) if has_strict_proof else 0
        if invalid_strict:
            raise RuntimeError(f"strict verified rows without exact-main proof: {invalid_strict}")
        episode_pool = _scalar(
            connection,
            "SELECT COUNT(*) FROM rail_pool WHERE type='series' AND instr(id, ':') > 0",
        )
        if episode_pool:
            raise RuntimeError(f"episode-shaped series rows in rail_pool: {episode_pool}")
        missing_title = _scalar(
            connection,
            """
            SELECT COUNT(*) FROM rail_pool rp
            LEFT JOIN titles t ON t.type=rp.type AND t.id=rp.id
            WHERE t.id IS NULL
            """,
        )
        if missing_title:
            raise RuntimeError(f"rail_pool rows without title state: {missing_title}")
        schema_version = _scalar(
            connection, "SELECT COALESCE(MAX(version), 0) FROM playability_migrations"
        )
        return {
            "quick_check": "ok",
            "foreign_key_errors": 0,
            "schema_version": schema_version,
            "titles": _scalar(connection, "SELECT COUNT(*) FROM titles"),
            "verified": _scalar(connection, "SELECT COUNT(*) FROM titles WHERE status='verified'"),
            "rail_pool": _scalar(connection, "SELECT COUNT(*) FROM rail_pool"),
            "strict_verified": _scalar(
                connection,
                "SELECT COUNT(*) FROM titles WHERE status='verified' AND proof_version >= 2",
            ) if has_strict_proof else 0,
        }


def online_backup(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with closing(_connect(source, readonly=True)) as source_connection:
        with closing(_connect(destination)) as destination_connection:
            source_connection.backup(destination_connection)


def _checkpoint(path: Path) -> tuple[int, int, int]:
    with closing(_connect(path)) as connection:
        row = connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if not row or len(row) != 3:
            raise RuntimeError(f"unexpected wal_checkpoint result for {path}: {row}")
        result = tuple(int(value) for value in row)
        if result[0] != 0:
            raise RuntimeError(f"busy wal_checkpoint for {path}: {result}")
        return result


def _fsync_path(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def _write_publication(
    staged: Path,
    *,
    publication_id: str,
    run_id: str,
    git_sha: str,
    config_hash: str,
    published_at: int,
) -> int:
    with closing(_connect(staged)) as connection:
        schema_version = _scalar(
            connection, "SELECT COALESCE(MAX(version), 0) FROM playability_migrations"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS playability_publication (
              state_id INTEGER PRIMARY KEY CHECK(state_id = 1),
              publication_id TEXT NOT NULL,
              run_id TEXT NOT NULL,
              git_sha TEXT NOT NULL,
              config_hash TEXT NOT NULL,
              schema_version INTEGER NOT NULL,
              published_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO playability_publication(
              state_id, publication_id, run_id, git_sha, config_hash,
              schema_version, published_at
            ) VALUES (1, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(state_id) DO UPDATE SET
              publication_id=excluded.publication_id,
              run_id=excluded.run_id,
              git_sha=excluded.git_sha,
              config_hash=excluded.config_hash,
              schema_version=excluded.schema_version,
              published_at=excluded.published_at
            """,
            (publication_id, run_id, git_sha, config_hash, schema_version, published_at),
        )
        connection.commit()
    return schema_version


def _read_publication(path: Path) -> dict[str, Any]:
    with closing(_connect(path, readonly=True)) as connection:
        if not _table_exists(connection, "playability_publication"):
            raise RuntimeError("publication receipt table missing after copy")
        row = connection.execute(
            """
            SELECT publication_id, run_id, git_sha, config_hash, schema_version, published_at
            FROM playability_publication WHERE state_id=1
            """
        ).fetchone()
        if not row:
            raise RuntimeError("publication receipt row missing after copy")
        keys = ("publication_id", "run_id", "git_sha", "config_hash", "schema_version", "published_at")
        return dict(zip(keys, row, strict=True))


def restore(snapshot: Path, live: Path) -> dict[str, Any]:
    validate_database(snapshot)
    online_backup(snapshot, live)
    checkpoint = _checkpoint(live)
    _fsync_path(live)
    return {"restored": True, "checkpoint": checkpoint, "validation": validate_database(live)}


def publish(
    staged: Path,
    live: Path,
    snapshot: Path,
    *,
    publication_id: str,
    run_id: str,
    git_sha: str,
    config_hash: str,
    published_at: int | None = None,
    inject_failure: str | None = None,
) -> dict[str, Any]:
    if len(git_sha) != 40 or any(character not in "0123456789abcdef" for character in git_sha.lower()):
        raise RuntimeError("git_sha must be the full 40-character hexadecimal revision")
    if len(config_hash) != 64 or any(character not in "0123456789abcdef" for character in config_hash.lower()):
        raise RuntimeError("config_hash must be a 64-character SHA-256 digest")
    published_at = published_at or int(time.time() * 1000)
    _write_publication(
        staged,
        publication_id=publication_id,
        run_id=run_id,
        git_sha=git_sha,
        config_hash=config_hash,
        published_at=published_at,
    )
    staged_validation = validate_database(staged)
    live_validation = validate_database(live)
    online_backup(live, snapshot)
    snapshot_validation = validate_database(snapshot)

    copied = False
    try:
        online_backup(staged, live)
        copied = True
        if inject_failure == "after_copy":
            raise RuntimeError("injected failure after copy")
        checkpoint = _checkpoint(live)
        if inject_failure == "after_checkpoint":
            raise RuntimeError("injected failure after checkpoint")
        _fsync_path(live)
        readback_validation = validate_database(live)
        receipt = _read_publication(live)
        expected = {
            "publication_id": publication_id,
            "run_id": run_id,
            "git_sha": git_sha,
            "config_hash": config_hash,
            "schema_version": staged_validation["schema_version"],
            "published_at": published_at,
        }
        if receipt != expected:
            raise RuntimeError(f"publication receipt mismatch: expected={expected} actual={receipt}")
        if inject_failure == "after_readback":
            raise RuntimeError("injected failure after readback")
        return {
            "ok": True,
            "publication": receipt,
            "checkpoint": checkpoint,
            "staged": staged_validation,
            "previous_live": live_validation,
            "snapshot": snapshot_validation,
            "readback": readback_validation,
        }
    except Exception:
        if copied:
            restore(snapshot, live)
        raise


def hash_files(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda item: str(item)):
        digest.update(str(path).encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    publish_parser = subparsers.add_parser("publish")
    publish_parser.add_argument("--staged", type=Path, required=True)
    publish_parser.add_argument("--live", type=Path, required=True)
    publish_parser.add_argument("--snapshot", type=Path, required=True)
    publish_parser.add_argument("--publication-id", required=True)
    publish_parser.add_argument("--run-id", required=True)
    publish_parser.add_argument("--git-sha", required=True)
    publish_parser.add_argument("--config-hash", required=True)
    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("path", type=Path)
    hash_parser = subparsers.add_parser("hash-config")
    hash_parser.add_argument("paths", nargs="+", type=Path)
    restore_parser = subparsers.add_parser("restore")
    restore_parser.add_argument("--snapshot", type=Path, required=True)
    restore_parser.add_argument("--live", type=Path, required=True)
    arguments = parser.parse_args()

    if arguments.command == "publish":
        result = publish(
            arguments.staged,
            arguments.live,
            arguments.snapshot,
            publication_id=arguments.publication_id,
            run_id=arguments.run_id,
            git_sha=arguments.git_sha.lower(),
            config_hash=arguments.config_hash.lower(),
        )
    elif arguments.command == "validate":
        result = validate_database(arguments.path)
    elif arguments.command == "hash-config":
        result = {"config_hash": hash_files(arguments.paths)}
    else:
        result = restore(arguments.snapshot, arguments.live)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"sqlite-publication: {error}", file=sys.stderr)
        raise SystemExit(1)
