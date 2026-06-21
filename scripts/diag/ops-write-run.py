#!/usr/bin/env python3
"""Append structured ops events from shell scripts (same format as catalog-service ops/log.ts)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def ops_root() -> Path:
    base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "mango" / "ops"


def append_event(
    kind: str,
    summary: str,
    payload: dict,
    *,
    run_id: str | None = None,
    source: str = "shell",
) -> None:
    root = ops_root()
    root.mkdir(parents=True, exist_ok=True)
    event = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "run_id": run_id,
        "source": source,
        "summary": summary,
        "payload": payload,
    }
    with (root / "events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")


def write_run_report(run_id: str, report: dict) -> Path:
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    directory = ops_root() / "reports" / date
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{run_id}.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Write mango ops event from shell")
    parser.add_argument("--kind", required=True)
    parser.add_argument("--summary", required=True)
    parser.add_argument("--run-id")
    parser.add_argument("--source", default="shell")
    parser.add_argument("--payload-file", help="JSON file or - for stdin")
    parser.add_argument("--write-report", action="store_true")
    args = parser.parse_args()

    payload: dict = {}
    if args.payload_file:
        raw = sys.stdin.read() if args.payload_file == "-" else Path(args.payload_file).read_text(encoding="utf-8")
        payload = json.loads(raw) if raw.strip() else {}

    append_event(args.kind, args.summary, payload, run_id=args.run_id, source=args.source)
    if args.write_report and args.run_id:
        write_run_report(
            args.run_id,
            {
                "kind": args.kind,
                "run_id": args.run_id,
                "source": args.source,
                "summary": args.summary,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                **payload,
            },
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
