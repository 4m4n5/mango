#!/usr/bin/env python3
"""Validate AIOStreams status against Mango's minimum supported release."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


def parse_version(value: str) -> tuple[int, int, int]:
    match = VERSION_RE.fullmatch(value.strip())
    if not match:
        raise ValueError(f"invalid semantic version: {value!r}")
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def status_version(payload: object) -> str:
    if not isinstance(payload, dict):
        raise ValueError("status response must be an object")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("status response is missing data")
    version = data.get("version")
    if not isinstance(version, str) or not version.strip():
        raise ValueError("status response is missing data.version")
    return version.strip()


def require_minimum(payload: object, minimum: str) -> str:
    actual = status_version(payload)
    if parse_version(actual) < parse_version(minimum):
        raise ValueError(
            f"AIOStreams {actual} is unsupported; Mango requires >= {minimum} "
            "for date-based series discovery and episode matching"
        )
    return actual


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("status_json", help="status JSON path, or - for stdin")
    parser.add_argument("--minimum", default="2.32.0")
    args = parser.parse_args()
    try:
        raw = (
            sys.stdin.read()
            if args.status_json == "-"
            else Path(args.status_json).read_text(encoding="utf-8")
        )
        payload = json.loads(raw)
        actual = require_minimum(payload, args.minimum)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    print(f"AIOStreams {actual} satisfies minimum {args.minimum}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
