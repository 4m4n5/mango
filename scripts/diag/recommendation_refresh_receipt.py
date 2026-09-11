#!/usr/bin/env python3
"""Read one exact maintenance receipt without mistaking missing evidence for success."""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys


def read_receipt(ops_dir: Path, run_id: str, started_ms: int) -> tuple[str, str, int]:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{7,127}", run_id):
        return "unknown", "invalid_run_id", 10
    path = ops_dir / f"recommendation-refresh-{run_id}.json"
    try:
        if path.stat().st_mtime_ns // 1_000_000 < started_ms:
            return "unknown", "stale_result", 10
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return "unknown", "missing_result", 10
    except (OSError, ValueError):
        return "unknown", "invalid_result", 10
    if not isinstance(payload, dict):
        return "unknown", "invalid_result", 10
    status = payload.get("status")
    message = payload.get("message")
    # Never print arbitrary provider errors, tokens, or whitespace-delimited fields.
    if not isinstance(message, str) or not re.fullmatch(r"[a-z0-9_]{1,100}", message):
        message = "invalid_message"
    if not isinstance(status, str) or status not in {"queued", "complete", "skipped", "warning"}:
        return "unknown", "invalid_status", 10
    rc = payload.get("rc")
    if type(rc) is not int or rc < 0 or rc > 255:
        return "unknown", "invalid_rc", 10
    accepted = payload.get("ok") is True and rc == 0
    if status == "queued":
        # Accepted durable work is not a claim that ranking has completed.
        ids = payload.get("job_ids")
        accepted = accepted and isinstance(ids, list) and bool(ids) and all(
            isinstance(job_id, str) and bool(job_id.strip()) for job_id in ids
        )
    elif status == "skipped":
        accepted = accepted and message == "disabled_by_env"
    elif status != "complete":
        accepted = False
    return status, message, 0 if accepted else (rc or 10)


if __name__ == "__main__":
    status, message, rc = read_receipt(Path(sys.argv[1]), sys.argv[2], int(sys.argv[3]))
    print(status, message, rc)
