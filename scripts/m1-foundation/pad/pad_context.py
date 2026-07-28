#!/usr/bin/env python3
"""Pure input-ownership decisions shared by the Mango pad router tests."""

from __future__ import annotations

import math


def contextual_secondary_surface(visible_surface: str, playback_active: bool) -> str:
    """Route X to what the user can see, then fall back to playback state."""

    if visible_surface == "launcher":
        return "launcher"
    if visible_surface == "mpv" or playback_active:
        return "mpv"
    return visible_surface


def secondary_press_kind(started_at: float, released_at: float, hold_sec: float) -> str:
    elapsed = released_at - started_at
    reached_hold = elapsed >= hold_sec or math.isclose(
        elapsed,
        hold_sec,
        rel_tol=0.0,
        abs_tol=1e-9,
    )
    return "hold" if reached_hold else "tap"
