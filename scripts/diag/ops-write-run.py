#!/usr/bin/env python3
"""Append structured ops events from shell scripts (same format as catalog-service ops/log.ts)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from ops_ledger import MAX_EVENT_BYTES, append_json_line, write_json_atomic


def encoded_size(value: object) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def scalar_summary(value: dict) -> dict:
    """Keep counters/status verbatim; verbose strings and collections live in the report."""
    result: dict = {}
    for key, item in value.items():
        if not isinstance(item, (str, int, float, bool, type(None))):
            continue
        if encoded_size({key: item}) > 2048:
            continue
        candidate = {**result, key: item}
        if encoded_size(candidate) <= 8192:
            result[key] = item
    return result


def compact_payload(payload: dict) -> dict:
    """Retain the scalar/rail contracts used by ops-report and ops_grow_sla.

    Per-title results and nested candidate diagnostics remain lossless in the
    report. Even an unexpectedly huge rail list cannot recreate an oversized
    event: summaries have a separate 64 KiB budget.
    """
    result = scalar_summary(payload)
    for key in ("before", "after", "batch_flush"):
        if isinstance(payload.get(key), dict):
            result[key] = scalar_summary(payload[key])
    rails = payload.get("rails")
    if isinstance(rails, list):
        result["rails"] = []
        for rail in rails:
            if not isinstance(rail, dict):
                continue
            row = scalar_summary(rail)
            for key in ("before", "after"):
                if isinstance(rail.get(key), dict):
                    row[key] = scalar_summary(rail[key])
            result["rails"].append(row)
            if encoded_size(result) > 64 * 1024:
                result["rails"].pop()
                break
        result["rails_total"] = len(rails)
        result["rails_summarized"] = len(result["rails"])
    return result


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
    write_report: bool = False,
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
    event_bytes = encoded_size(event)
    oversized = event_bytes > MAX_EVENT_BYTES
    if write_report or oversized:
        # Persist and fsync the full artifact before publishing its reference.
        # A failed report write must fail the command, not emit a success event.
        # Multiple phases can share a run ID. An event reference must never
        # point at the canonical run report that a later phase may overwrite.
        report_id = (
            f"{run_id or 'ops-event'}-{uuid4().hex}"
            if oversized else (run_id or f"ops-event-{uuid4().hex}")
        )
        report_path = write_run_report(
            report_id,
            {
                "kind": kind,
                "run_id": run_id,
                "source": source,
                "summary": summary,
                "finished_at": event["ts"],
                **payload,
            },
        )
        if oversized:
            event["payload"] = {
                **compact_payload(payload),
                "payload_in_report": True,
                "report_path": str(report_path),
                "original_event_bytes": event_bytes,
            }
    append_json_line(root / "events.jsonl", event)


def write_run_report(run_id: str, report: dict) -> Path:
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    directory = ops_root() / "reports" / date
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{run_id}.json"
    write_json_atomic(path, report)
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
    if not isinstance(payload, dict):
        parser.error("payload must be a JSON object")

    append_event(
        args.kind, args.summary, payload, run_id=args.run_id,
        source=args.source, write_report=args.write_report,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
