#!/usr/bin/env python3
"""Preflight policy for source-hitrate before grow — skip/run and per-source sample size."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

DEFAULT_REPORT = Path.home() / ".cache/mango/source-hitrate/latest.json"
FRESH_HOURS = float(os.environ.get(
    "MANGO_SOURCE_HITRATE_FRESH_HOURS",
    os.environ.get("MANGO_SOURCE_HITRATE_QUICK_FRESH_HOURS", "24"),
))
QUICK_PER_SOURCE = int(os.environ.get("MANGO_SOURCE_HITRATE_QUICK_PER_SOURCE", "1"))
NIGHTLY_PER_SOURCE = int(os.environ.get("MANGO_SOURCE_HITRATE_NIGHTLY_PER_SOURCE", "3"))


def report_path() -> Path:
    raw = os.environ.get("MANGO_SOURCE_HITRATE_OUT", "")
    return Path(raw).expanduser() if raw else DEFAULT_REPORT


def report_age_hours(path: Path | None = None) -> float | None:
    path = path or report_path()
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        ts = int(raw.get("ts") or 0)
        if ts <= 0:
            return (time.time() - path.stat().st_mtime) / 3600
        return (time.time() - ts) / 3600
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return (time.time() - path.stat().st_mtime) / 3600


def per_source_for_preset(preset: str) -> int:
    if preset == "quick":
        return max(1, QUICK_PER_SOURCE)
    return max(1, NIGHTLY_PER_SOURCE)


def should_skip_preflight(preset: str, *, force: bool = False) -> tuple[bool, str]:
    if force:
        return False, "run"
    age = report_age_hours()
    if age is None:
        return False, "no cached report"
    if age <= FRESH_HOURS:
        return True, f"cached report {age:.1f}h old (<{FRESH_HOURS:.0f}h)"
    return False, f"cached report stale ({age:.1f}h)"


def cmd_decide(args: argparse.Namespace) -> int:
    skip, reason = should_skip_preflight(args.preset, force=args.force)
    print("skip" if skip else "run")
    if args.verbose:
        print(f"reason: {reason}", file=sys.stderr)
        print(f"per_source: {per_source_for_preset(args.preset)}", file=sys.stderr)
    return 0


def cmd_info(args: argparse.Namespace) -> int:
    path = report_path()
    age = report_age_hours(path)
    payload = {
        "report_path": str(path),
        "report_exists": path.is_file(),
        "age_hours": age,
        "fresh_hours": FRESH_HOURS,
        "per_source": per_source_for_preset(args.preset),
        "skip": should_skip_preflight(args.preset, force=False)[0],
    }
    print(json.dumps(payload, indent=2))
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    skip, reason = should_skip_preflight(args.preset, force=args.force)
    print(json.dumps({
        "decision": "skip" if skip else "run",
        "reason": reason,
        "per_source": per_source_for_preset(args.preset),
        "preset": args.preset,
        "force": args.force,
    }))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="source-hitrate preflight policy")
    sub = parser.add_subparsers(dest="command", required=True)

    decide = sub.add_parser("decide", help="print skip or run")
    decide.add_argument("--preset", choices=["quick", "nightly"], default="quick")
    decide.add_argument("--force", action="store_true", help="always run (nightly grow phase)")
    decide.add_argument("--verbose", action="store_true")
    decide.set_defaults(func=cmd_decide)

    plan = sub.add_parser("plan", help="JSON plan: decision, reason, per_source")
    plan.add_argument("--preset", choices=["quick", "nightly"], default="quick")
    plan.add_argument("--force", action="store_true")
    plan.set_defaults(func=cmd_plan)

    info = sub.add_parser("info", help="JSON summary for monitoring")
    info.add_argument("--preset", choices=["quick", "nightly"], default="quick")
    info.set_defaults(func=cmd_info)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
