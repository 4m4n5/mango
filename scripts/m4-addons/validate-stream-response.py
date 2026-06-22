#!/usr/bin/env python3
"""Validate GET /stream JSON against N3d gate rules for one fixture."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


def load_fixture(fixtures_path: Path, label: str) -> dict[str, Any]:
    data = json.loads(fixtures_path.read_text(encoding="utf-8"))
    for fixture in data.get("fixtures") or []:
        if fixture.get("label") == label:
            return fixture
    raise SystemExit(f"fixture not found: {label}")


def validate_payload(
    payload: dict[str, Any],
    fixture: dict[str, Any],
    *,
    require_display_label: bool = False,
) -> str:
    streams = payload.get("streams") or []
    min_streams = int(fixture.get("min_streams", 1))
    min_unique_urls = int(fixture.get("min_unique_urls", 1))
    label = fixture.get("label", "?")

    if len(streams) < min_streams:
        raise SystemExit(
            f"{label}: expected >={min_streams} streams, got {len(streams)}",
        )

    bad_urls = [
        stream.get("url", "")
        for stream in streams
        if re.search(r"rate-limit-exceeded|public-rate-limit", stream.get("url", ""), re.I)
    ]
    if bad_urls:
        raise SystemExit(f"{label}: rate-limit placeholder URLs: {len(bad_urls)}")

    sources = sorted({str(stream.get("source") or "") for stream in streams})
    if not any(source == "AIOStreams" for source in sources):
        raise SystemExit(f"{label}: AIOStreams source missing; sources={sources}")
    if any("ElfHosted" in source for source in sources):
        raise SystemExit(f"{label}: ElfHosted source still present; sources={sources}")
    if any("Torrentio" in source for source in sources):
        raise SystemExit(f"{label}: standalone Torrentio in export; sources={sources}")

    urls = {stream.get("url") or "" for stream in streams}
    unique_urls = len({url for url in urls if url})
    if unique_urls < min_unique_urls:
        raise SystemExit(
            f"{label}: low url diversity: {unique_urls} unique urls "
            f"(need >={min_unique_urls}) in {len(streams)} streams",
        )

    display_labels = [
        stream.get("display_label") or stream.get("name") or stream.get("title") or ""
        for stream in streams
    ]
    unique_labels = len(set(display_labels))
    has_display_label = any(stream.get("display_label") for stream in streams)
    enforce_display_label = require_display_label or has_display_label

    if enforce_display_label:
        missing = sum(1 for stream in streams if not stream.get("display_label"))
        if missing:
            raise SystemExit(f"{label}: display_label missing on {missing} stream(s)")
        min_unique_labels = int(fixture.get("min_unique_display_labels", 2))
        if len(streams) >= min_unique_labels and unique_labels < min_unique_labels:
            mode = "low" if require_display_label else "not distinct"
            raise SystemExit(
                f"{label}: {mode} display_label diversity: {unique_labels} unique "
                f"in {len(streams)} streams (need >={min_unique_labels})",
            )

    names = [stream.get("name") or stream.get("title") or "" for stream in streams]
    unique_names = len(set(names))

    return (
        f"{label}: streams={len(streams)} unique_urls={unique_urls} "
        f"unique_labels={unique_labels} unique_names={unique_names} "
        f"sources={','.join(sources)}"
    )


def main() -> int:
    if len(sys.argv) < 3:
        print(
            "usage: validate-stream-response.py <response.json> <fixtures.json> <label> "
            "[--require-display-label]",
            file=sys.stderr,
        )
        return 2

    response_path = Path(sys.argv[1])
    fixtures_path = Path(sys.argv[2])
    label = sys.argv[3]
    require_display_label = "--require-display-label" in sys.argv[4:]

    fixture = load_fixture(fixtures_path, label)
    payload = json.loads(response_path.read_text(encoding="utf-8"))
    print(validate_payload(payload, fixture, require_display_label=require_display_label))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
