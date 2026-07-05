#!/usr/bin/env python3
"""Ensure /etc/mango/config.yaml llm.max_tokens supports full voice tool-use turns."""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

CONFIG = Path("/etc/mango/config.yaml")
MIN_MAX_TOKENS = 1024


def main() -> int:
    if not CONFIG.is_file():
        print(f"skip: missing {CONFIG}", file=sys.stderr)
        return 0
    raw = yaml.safe_load(CONFIG.read_text(encoding="utf-8")) or {}
    llm = dict(raw.get("llm") or {})
    current = int(llm.get("max_tokens") or 0)
    if current >= MIN_MAX_TOKENS:
        print(f"OK: llm.max_tokens already {current} (>= {MIN_MAX_TOKENS})")
        return 0
    llm["max_tokens"] = MIN_MAX_TOKENS
    raw["llm"] = llm
    CONFIG.write_text(yaml.dump(raw, default_flow_style=False, sort_keys=False), encoding="utf-8")
    print(f"OK: llm.max_tokens {current} -> {MIN_MAX_TOKENS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
