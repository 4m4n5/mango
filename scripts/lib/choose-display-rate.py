#!/usr/bin/env python3
"""Pick an HDMI refresh rate for a source frame rate.

Film (23.976/24) keeps an exact 24 Hz mode when the TV has one. 25/30 fps
must not use 25/30 Hz: many TVs implement those modes poorly and hitch
every few seconds. Prefer a clean 2x onto 50/59.94/60 instead.
"""

from __future__ import annotations

import sys

FILM_FPS_MAX = 24.5
EXACT_MATCH = 0.08
MULTIPLE_SLACK = 0.015
LOW_EXACT_HZ_MAX = 48.0


def choose_display_rate(target_fps: float, rates: list[float]) -> float | None:
    if target_fps <= 0 or not rates:
        return None

    film = target_fps <= FILM_FPS_MAX
    best: tuple[float, float] | None = None
    for rate in rates:
        diff = abs(rate - target_fps)
        score: float | None = None
        if diff <= EXACT_MATCH:
            if film or rate >= LOW_EXACT_HZ_MAX:
                score = diff
            else:
                score = 20.0 + diff
        else:
            ratio = rate / target_fps
            nearest = round(ratio)
            if 2 <= nearest <= 5 and abs(ratio - nearest) <= MULTIPLE_SLACK:
                score = 10.0 + abs(ratio - nearest) + nearest / 100.0
        if score is None:
            continue
        if best is None or score < best[0]:
            best = (score, rate)
    return None if best is None else best[1]


def choose_display_rate_label(target_fps: float, labels: list[str]) -> str | None:
    parsed: list[tuple[str, float]] = []
    for label in labels:
        try:
            parsed.append((label, float(label)))
        except ValueError:
            continue
    chosen = choose_display_rate(target_fps, [rate for _, rate in parsed])
    if chosen is None:
        return None
    for label, rate in parsed:
        if rate == chosen:
            return label
    return None


def _self_test() -> None:
    cases = [
        (30.0, ["120.00", "60.00", "59.94", "30.00", "29.97"], "60.00"),
        (29.97, ["60.00", "59.94", "30.00", "29.97"], "59.94"),
        (25.0, ["60.00", "50.00", "25.00"], "50.00"),
        (24.0, ["60.00", "24.00", "23.98"], "24.00"),
        (23.976, ["59.94", "24.00", "23.98"], "23.98"),
        (60.0, ["120.00", "60.00", "59.94"], "60.00"),
        (59.94, ["60.00", "59.94"], "59.94"),
        (50.0, ["60.00", "50.00"], "50.00"),
    ]
    for fps, labels, expected in cases:
        got = choose_display_rate_label(fps, labels)
        if got != expected:
            raise SystemExit(f"choose-display-rate {fps} {labels} -> {got!r}, expected {expected!r}")


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-test":
        _self_test()
        print("choose-display-rate: ok")
        return 0
    if len(sys.argv) < 3:
        print("usage: choose-display-rate.py <fps> <rate> [rate...]", file=sys.stderr)
        print("       choose-display-rate.py --self-test", file=sys.stderr)
        return 2
    try:
        fps = float(sys.argv[1])
    except ValueError:
        return 1
    label = choose_display_rate_label(fps, sys.argv[2:])
    if not label:
        return 1
    print(label)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
