#!/usr/bin/env python3
"""Serialized, durable writer for Mango's append-only ops run ledger."""

from __future__ import annotations

import fcntl
import json
import os
import tempfile
from pathlib import Path


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _with_lock(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    handle = (root / ".ledger.lock").open("a+", encoding="utf-8")
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    return handle


def append_json_line(path: Path, payload: dict) -> None:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > 1_000_000:
        raise ValueError("ops ledger event exceeds 1MB")
    lock = _with_lock(path.parent)
    try:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(encoded + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        _fsync_dir(path.parent)
    finally:
        lock.close()


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_root = path.parents[2] if len(path.parents) >= 3 else path.parent
    lock = _with_lock(lock_root)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        _fsync_dir(path.parent)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
        lock.close()


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--append", type=Path)
    group.add_argument("--write", type=Path)
    args = parser.parse_args()
    value = json.load(sys.stdin)
    if not isinstance(value, dict):
        raise SystemExit("ledger payload must be an object")
    if args.append:
        append_json_line(args.append, value)
    else:
        write_json_atomic(args.write, value)
