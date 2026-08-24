#!/usr/bin/env python3
"""Fail if personal hosts, users, or live credential URLs re-enter public files."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {"node_modules", ".venv", "dist", ".git"}
SKIP_PREFIXES = ("docs/tasks/", "docs/archive/", "marketing/out/")
FORBIDDEN = [
    (re.compile(r"\b10\.0\.0\.174\b"), "household LAN address"),
    (re.compile(r"/home/aman\b"), "household home path"),
    (re.compile(r"\bE4:17:D8:EB:00:44\b"), "household Bluetooth MAC"),
    (re.compile(r"\bUser=aman\b"), "household systemd user"),
]

def main() -> int:
    hits: list[str] = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT).as_posix()
        if path.name == "check-public-surface.py":
            continue
        if any(part in SKIP_PARTS for part in path.relative_to(ROOT).parts):
            continue
        if any(rel.startswith(prefix) for prefix in SKIP_PREFIXES):
            continue
        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".db"}:
            hits.append(f"{rel}: binary media is not allowed in the public tree")
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for pattern, reason in FORBIDDEN:
            if pattern.search(text):
                hits.append(f"{rel}: {reason}")
    if hits:
        print("public-surface violations:")
        for hit in hits:
            print(f"  {hit}")
        return 1
    print("ok public surface")
    return 0


if __name__ == "__main__":
    sys.exit(main())
