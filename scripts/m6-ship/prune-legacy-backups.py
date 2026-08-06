#!/usr/bin/env python3
"""Verify retained backup sets and prune older legacy backup-only artifacts."""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path
import re
import shutil
import sqlite3


LEGACY_STATE = re.compile(r"^(library|progress)-(\d{8}-\d{6})\.db$")


def quick_check(path: Path) -> None:
    # Backup artifacts are standalone snapshots. Immutable read-only mode both
    # proves that contract and prevents SQLite from creating WAL/SHM sidecars in
    # the backup directory during verification.
    connection = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
    try:
        result = connection.execute("PRAGMA quick_check").fetchone()
    finally:
        connection.close()
    if result is None or result[0] != "ok":
        raise RuntimeError(f"SQLite quick_check failed: {path}: {result}")


def snapshot_candidates(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(
        (path for path in root.iterdir()
         if path.is_dir() and (
             (path / "library.db").is_file()
             or (path / "library.db.backup").is_file()
         )),
        key=lambda path: (path.stat().st_mtime_ns, path.name),
        reverse=True,
    )


def legacy_state_groups(root: Path) -> list[tuple[str, list[Path]]]:
    groups: dict[str, list[Path]] = defaultdict(list)
    if root.is_dir():
        for path in root.iterdir():
            match = LEGACY_STATE.match(path.name)
            if match:
                groups[match.group(2)].append(path)
    return sorted(groups.items(), reverse=True)


def validated_keep(paths: list[Path], retention: int) -> list[Path]:
    retained = paths[:retention]
    if len(retained) < retention:
        raise RuntimeError(
            f"refusing prune: found {len(retained)} complete sets, need {retention}"
        )
    for backup_set in retained:
        databases = sorted(backup_set.glob("*.db")) + sorted(
            backup_set.glob("*.db.backup")
        )
        if not databases:
            raise RuntimeError(f"retained set contains no databases: {backup_set}")
        for database in databases:
            quick_check(database)
    return retained


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup-root", type=Path, required=True)
    parser.add_argument("--retention", type=int, default=3)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.retention < 1:
        parser.error("--retention must be positive")

    root = args.backup_root.expanduser().resolve()
    if root == Path("/") or root == Path.home().resolve():
        raise RuntimeError(f"unsafe backup root: {root}")

    state_root = root / "state"
    snapshot_root = root / "agent-snapshots"
    snapshots = snapshot_candidates(snapshot_root)
    retained_snapshots = validated_keep(snapshots, args.retention)
    obsolete_snapshots = snapshots[args.retention:]

    legacy = legacy_state_groups(state_root)
    if len(legacy) < args.retention:
        raise RuntimeError(
            f"refusing prune: found {len(legacy)} legacy state sets, need {args.retention}"
        )
    for _, files in legacy[:args.retention]:
        for database in files:
            quick_check(database)
    obsolete_state = legacy[args.retention:]

    print("retained snapshots:")
    for path in retained_snapshots:
        print(f"  {path}")
    print("obsolete snapshots:")
    for path in obsolete_snapshots:
        print(f"  {path}")
    print("retained legacy state timestamps:")
    for timestamp, _ in legacy[:args.retention]:
        print(f"  {timestamp}")
    print("obsolete legacy state timestamps:")
    for timestamp, _ in obsolete_state:
        print(f"  {timestamp}")

    if not args.apply:
        print("dry run; pass --apply to remove obsolete backup-only artifacts")
        return 0

    for path in obsolete_snapshots:
        shutil.rmtree(path)
    for _, files in obsolete_state:
        for path in files:
            path.unlink()
            for suffix in ("-wal", "-shm"):
                sidecar = Path(f"{path}{suffix}")
                if sidecar.exists():
                    sidecar.unlink()
    # Older verification tools could create zero/small WAL sidecars beside the
    # retained standalone snapshots. They are never part of a backup set.
    for _, files in legacy[:args.retention]:
        for path in files:
            for suffix in ("-wal", "-shm"):
                sidecar = Path(f"{path}{suffix}")
                if sidecar.exists():
                    sidecar.unlink()
    print("prune complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
