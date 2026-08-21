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


def resolve_secondary_surface(
    foreground_surface: str,
    playback_active: bool,
    *,
    launcher_window_available: bool,
    mpv_window_available: bool,
) -> str:
    """Resolve X from windows once at button-down.

    X11 can briefly report the desktop or an overlay as active while Chromium
    remains the visible couch surface. A real mpv window takes precedence over
    an available launcher window; a stale playback marker does not.
    """

    if foreground_surface in {"launcher", "mpv"}:
        return foreground_surface
    if mpv_window_available:
        return "mpv"
    if launcher_window_available:
        return "launcher"
    return contextual_secondary_surface(foreground_surface, playback_active)


def secondary_press_kind(started_at: float, released_at: float, hold_sec: float) -> str:
    elapsed = released_at - started_at
    reached_hold = elapsed >= hold_sec or math.isclose(
        elapsed,
        hold_sec,
        rel_tol=0.0,
        abs_tol=1e-9,
    )
    return "hold" if reached_hold else "tap"


def seek_hud_reason(direction: str, seconds: int) -> str:
    """Encode the exact signed seek delta without changing seek ownership."""

    if direction not in {"left", "right"} or seconds <= 0:
        raise ValueError("seek requires left/right and a positive step")
    signed_seconds = -seconds if direction == "left" else seconds
    return f"seek:{signed_seconds:+d}"
