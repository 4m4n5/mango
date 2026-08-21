#!/usr/bin/env python3
"""Acquire a permanent-path advisory lock and exec a command while holding it."""

from __future__ import annotations

import fcntl
import os
import sys


def main() -> int:
    if len(sys.argv) < 6 or sys.argv[4] != "--":
        print(
            "usage: stable-flock-exec.py LOCK ENV_KEY BUSY_MESSAGE -- COMMAND [ARG...]",
            file=sys.stderr,
        )
        return 2

    lock_path, env_key, busy_message = sys.argv[1:4]
    command = sys.argv[5:]
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_APPEND, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        print(busy_message, file=sys.stderr)
        return 75

    os.dup2(fd, 210)
    if fd != 210:
        os.close(fd)
    os.set_inheritable(210, True)
    os.environ[env_key] = "1"
    os.execvp(command[0], command)
    return 127


if __name__ == "__main__":
    raise SystemExit(main())
