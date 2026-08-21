#!/usr/bin/env python3
"""Fail on broken relative markdown links in the public doc set."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
SKIP_PREFIXES = ("http://", "https://", "mailto:", "#")
SKIP_DIRS = {
    "docs/tasks",
    "docs/archive",
    "node_modules",
    ".venv",
    "dist",
    "assets",
}


def iter_markdown() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*.md"):
        rel = path.relative_to(ROOT).as_posix()
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        files.append(path)
    return files


def resolve_target(source: Path, href: str) -> Path | None:
    href = href.split("#", 1)[0].strip()
    if not href or href.startswith(SKIP_PREFIXES):
        return None
    return (source.parent / href).resolve()


def main() -> int:
    broken: list[str] = []
    for path in iter_markdown():
        text = path.read_text(encoding="utf-8")
        for match in LINK.finditer(text):
            target = resolve_target(path, match.group(1))
            if target is None:
                continue
            try:
                target.relative_to(ROOT)
            except ValueError:
                continue
            if not target.exists():
                broken.append(f"{path.relative_to(ROOT)} -> {match.group(1)}")
    if broken:
        print("broken documentation links:")
        for item in broken:
            print(f"  {item}")
        return 1
    print(f"ok {len(iter_markdown())} markdown files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
