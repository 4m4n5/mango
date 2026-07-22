#!/usr/bin/env python3
"""Minimal, comment-preserving BlueZ main.conf patcher for Mango."""

from __future__ import annotations

import re
import sys
from pathlib import Path


MANAGED_VALUES = {
    "General": {"FastConnectable": "true", "AlwaysPairable": "false"},
    "Policy": {
        "AutoEnable": "true",
        "ReconnectUUIDs": "00001124-0000-1000-8000-00805f9b34fb",
        "ReconnectAttempts": "7",
        "ReconnectIntervals": "1,2,4,8,16,32,64",
    },
}


def patch_main_conf(path: Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    for section, values in MANAGED_VALUES.items():
        header = f"[{section}]"
        try:
            start = next(index for index, line in enumerate(lines) if line.strip() == header)
        except StopIteration:
            if lines and lines[-1].strip():
                lines.append("")
            lines.append(header)
            start = len(lines) - 1
        end = next(
            (index for index in range(start + 1, len(lines)) if re.match(r"^\s*\[.+\]\s*$", lines[index])),
            len(lines),
        )
        for key, value in values.items():
            pattern = re.compile(rf"^\s*{re.escape(key)}\s*=")
            existing = next((index for index in range(start + 1, end) if pattern.match(lines[index])), None)
            replacement = f"{key} = {value}"
            if existing is None:
                lines.insert(end, replacement)
                end += 1
            else:
                lines[existing] = replacement
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] != "--patch":
        print(f"usage: {argv[0]} --patch /etc/bluetooth/main.conf", file=sys.stderr)
        return 2
    patch_main_conf(Path(argv[2]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
