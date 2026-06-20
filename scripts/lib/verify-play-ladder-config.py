#!/usr/bin/env python3
"""Shared play_ladder contract for deploy gates (gate-lite-unit, gate-n3a-play-ladder)."""
from __future__ import annotations

import json
import sys


def main() -> int:
    path = sys.argv[1]
    strict = '--strict' in sys.argv[2:]
    data = json.load(open(path, encoding='utf-8'))
    ladder = data.get('play_ladder') or []
    if len(ladder) < 3:
        raise SystemExit('play_ladder needs at least 3 steps')
    if data.get('preferred_quality') != '1080p':
        raise SystemExit('preferred_quality must be 1080p')
    if int(data.get('auto_play_wall_ms') or 0) < 60000:
        raise SystemExit('auto_play_wall_ms too low')
    steps = [step.get('step') for step in ladder]
    if steps[0] != 'ideal':
        raise SystemExit('first ladder step must be ideal')
    if strict:
        if int(data.get('auto_play_max_attempts') or 0) < 8:
            raise SystemExit('auto_play_max_attempts too low')
        for step in ladder:
            addons = [str(item).lower() for item in step.get('addons', [])]
            if not any('aiostreams' in item for item in addons):
                raise SystemExit(f"{step.get('step')}: needs AIOStreams")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
