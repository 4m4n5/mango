#!/usr/bin/env python3
"""Cross-process read of the catalog recommendation maintenance lease."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable

LEASE_STALE_MS = 30_000


def recommendation_maintenance_active(
    payload: Any,
    *,
    now_ms: int | None = None,
    pid_alive: Callable[[int], bool] | None = None,
) -> bool:
    if not isinstance(payload, dict):
        return False
    heartbeat = payload.get("heartbeat_at")
    pid = payload.get("pid")
    if not isinstance(heartbeat, (int, float)) or not isinstance(pid, int) or pid <= 0:
        return False
    now = int(time.time() * 1000) if now_ms is None else now_ms
    if now - int(heartbeat) > LEASE_STALE_MS:
        return False
    if pid_alive is not None:
        return pid_alive(pid)
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except (ProcessLookupError, OSError):
        return False


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: recommendation_maintenance_lease.py LEASE_PATH", file=sys.stderr)
        return 2
    try:
        payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 1
    return 0 if recommendation_maintenance_active(payload) else 1


if __name__ == "__main__":
    raise SystemExit(main())
