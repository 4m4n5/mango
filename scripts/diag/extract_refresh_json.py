#!/usr/bin/env python3
"""Extract or synthesize playability refresh JSON from maintenance command output."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def _payload_score(payload: Any, consumed: int) -> int:
    if not isinstance(payload, dict):
        return -1
    score = consumed
    if "mode" in payload:
        score += 1_000_000
    if "duration_ms" in payload:
        score += 1_000_000
    if "rails" in payload:
        score += 1_000_000
    if "failure_category" in payload:
        score += 500_000
    return score


def extract_refresh_payload(raw: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    best: tuple[int, dict[str, Any]] | None = None
    for index, char in enumerate(raw):
        if char != "{":
            continue
        try:
            parsed, consumed = decoder.raw_decode(raw[index:])
        except json.JSONDecodeError:
            continue
        score = _payload_score(parsed, consumed)
        if score < 0:
            continue
        if best is None or score >= best[0]:
            best = (score, parsed)
    return best[1] if best else None


def load_state(path: Path | None) -> dict[str, Any]:
    if not path:
        return {}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def fallback_payload(args: argparse.Namespace, raw: str) -> dict[str, Any]:
    state = load_state(Path(args.state_path) if args.state_path else None)
    started_at = int(args.start_ms or 0)
    finished_at = int(args.end_ms or 0)
    duration_ms = max(0, finished_at - started_at) if started_at and finished_at else None
    message = str(state.get("message") or "").strip()
    error = message or f"refresh command exited rc={args.rc} without a JSON payload"
    category = str(state.get("failure_category") or "missing_completion_report")
    stage = str(state.get("stage") or state.get("phase") or "completion_report")
    payload: dict[str, Any] = {
        "ok": False,
        "mode": args.mode,
        "bootstrap": False,
        "strict_grow_sla": True,
        "started_at": started_at or None,
        "finished_at": finished_at or None,
        "duration_ms": duration_ms,
        "stage": stage,
        "failure_category": category,
        "error": error,
        "run_id": args.run_id,
        "repair_suggestions": [
            "Inspect the matching maintenance log for interruption, mixed stdout, or indexer crash details.",
            "Do not use older refresh JSON as evidence for this grow baseline.",
        ],
        "unique_candidates": 0,
        "verify_queue_size": 0,
        "linked_existing": 0,
        "verified": 0,
        "failed": 0,
        "skipped_existing": 0,
        "skipped_recent_failed": 0,
        "batch_flush": {"verify_count": 0, "pool_count": 0},
        "pruned_pool_entries": 0,
        "ingest_fresh_queued": 0,
        "ingest_scanned": 0,
        "rails": [],
        "grow_state": state,
        "raw_excerpt": raw[-2000:],
    }
    for key in ("rail_id", "rail_label", "grow_target", "fresh_verified", "attempts", "candidates_seen"):
        if key in state:
            payload[key] = state[key]
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--mode", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--start-ms", type=int, default=0)
    parser.add_argument("--end-ms", type=int, default=0)
    parser.add_argument("--rc", type=int, default=0)
    parser.add_argument("--state-path", default="")
    args = parser.parse_args()

    raw = sys.stdin.read()
    payload = extract_refresh_payload(raw)
    kind = "extracted"
    if payload is None:
        payload = fallback_payload(args, raw)
        kind = "fallback"
    Path(args.out).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(kind)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
