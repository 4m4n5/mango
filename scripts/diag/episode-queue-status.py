#!/usr/bin/env python3
"""List pending series follow-up episodes queued after S1E1 verify."""

from __future__ import annotations

import json
import os
import sqlite3
import sys

DB = os.environ.get("MANGO_PLAYABILITY_DB", "/etc/mango/playability.db")
LIMIT = int(os.environ.get("MANGO_EPISODE_QUEUE_LIMIT", "20"))


def main() -> int:
    if not os.path.isfile(DB):
        print(f"no playability db at {DB}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT series_id, episode_id, season, episode, status, queued_at, updated_at
            FROM series_episode_queue
            WHERE status = 'pending'
            ORDER BY queued_at ASC
            LIMIT ?
            """,
            (LIMIT,),
        ).fetchall()
    except sqlite3.OperationalError as exc:
        print(f"episode queue table missing or unreadable: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()

    pending = [dict(row) for row in rows]
    print(json.dumps({"pending": len(pending), "items": pending}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
